// Orchestrator state machine (05 §3). Resumable: state is saved in agent_sessions after each transition.
import { getIssue, updateIssue, type IssueStatus } from "../db/repo/issues.ts";
import { getEnvironment, latestAccessProfile } from "../db/repo/environments.ts";
import { listRepos } from "../db/repo/code.ts";
import { countToolCalls, finishStep, getSession, listToolCallsForSession, startStep, updateSession, type AgentSession } from "../db/repo/sessions.ts";
import { addMessage } from "../db/repo/threads.ts";
import { listHypotheses, listEvidence } from "../db/repo/evidence.ts";
import { getSetting } from "../db/repo/settings.ts";
import { enqueue } from "../db/repo/jobs.ts";
import { insertToolCall } from "../db/repo/sessions.ts";
import { listReproScripts } from "../db/repo/artifacts.ts";
import { emit } from "../realtime/events.ts";
import { callLlm } from "../llm/client.ts";
import { maxTokensFor, modelFor } from "../llm/models.ts";
import { textOf, toolUses, type ContentBlock, type MessageParam, type ToolResultBlock } from "../llm/types.ts";
import { createLogger } from "../lib/log.ts";
import { dataPath } from "../lib/fs.ts";
import { errorMessage } from "../lib/result.ts";
import { ALL_TOOLS } from "./tools/defs.ts";
import { availableTools, toApiTools } from "./tools/registry.ts";
import { executeTool } from "./tools/execute.ts";
import { issueBoard, stateInstruction, systemBlocks } from "./context.ts";
import { STATES, STATE_LABEL } from "./states.ts";
import { runTriage } from "./triage.ts";
import { draftRootCause } from "./report-draft.ts";
import type { AgentState, ToolCtx } from "./types.ts";

export type Limits = { maxToolCalls: number; maxDurationMs: number };
export const limits = (): Limits => ({ maxToolCalls: getSetting("agent.max_tool_calls", 60), maxDurationMs: getSetting("agent.max_duration_min", 20) * 60_000 });

const ISSUE_STATUS: Partial<Record<AgentState, IssueStatus>> = {
  TRIAGE: "investigating", INVESTIGATE: "investigating", HYPOTHESIZE: "investigating", REPRODUCE: "investigating", ROOT_CAUSE: "investigating",
  AWAIT_USER: "awaiting_user", FIX: "fixing", VALIDATE: "fixing", AWAIT_DEPLOY_APPROVAL: "awaiting_user", DEPLOY_SANDBOX: "verifying", VERIFY: "verifying", BLOCKED: "blocked", BUDGET_EXCEEDED: "budget_exceeded",
};

type LoopOutcome =
  | { kind: "transition"; next: AgentState; summary: string }
  | { kind: "checkpoint"; question: string; options?: string[] }
  | { kind: "budget"; message: string }
  | { kind: "error"; message: string };

export class Orchestrator {
  private log;
  private recentCalls: string[] = [];
  private escalated = false;
  private hypothesisRounds: number[] = [];

  constructor(private sessionId: string, private signal: AbortSignal, private directive?: string) {
    this.log = createLogger({ sessionId }, dataPath("logs", `${sessionId}.jsonl`));
  }

  private get session(): AgentSession {
    const s = getSession(this.sessionId);
    if (!s) throw new Error("session not found");
    return s;
  }

  /** Set the issue status, except that waiting for the user after a root cause keeps the issue root_caused. */
  private setIssueStatus(target: IssueStatus) {
    const cur = getIssue(this.session.issue_id);
    if (!cur || ["resolved", "closed", "cancelled"].includes(cur.status)) return;
    if (target === "awaiting_user" && cur.status === "root_caused") return;
    if (cur.status === target) return;
    updateIssue(cur.id, { status: target });
    emit({ type: "issue.updated", issueId: cur.id, patch: { status: target } });
  }

  private transition(next: AgentState, summary?: string) {
    const s = this.session;
    const step = startStep({ session_id: s.id, state: s.state, kind: "transition", title: `${s.state} → ${next}`, summary: summary ?? "" });
    finishStep(step.id, { status: "done" });
    emit({ type: "step.done", issueId: s.issue_id, sessionId: s.id, step: { id: step.id, seq: step.seq, state: s.state, kind: "transition", title: step.title, summary: summary ?? null } });
    updateSession(s.id, { state: next });
    emit({ type: "session.state", sessionId: s.id, issueId: s.issue_id, state: next, status: "running" });
    const st = ISSUE_STATUS[next];
    // "reproduced" means a runner reproduction (E3) exists; E4 from static code analysis alone is still "investigating".
    if (st) this.setIssueStatus(st === "investigating" && listEvidence(s.issue_id).some((e) => e.level === 3) ? "reproduced" : st);
    this.log.info("transition", { next, summary });
  }

  private pause(status: "awaiting_user" | "budget_exceeded" | "failed" | "done" | "cancelled", error?: string) {
    const s = this.session;
    updateSession(s.id, { status, ...(error ? { error } : {}) });
    emit({ type: status === "done" || status === "failed" || status === "cancelled" ? "session.ended" : "session.state", sessionId: s.id, issueId: s.issue_id, state: s.state, status });
    const issueStatus: IssueStatus | null = status === "awaiting_user" ? "awaiting_user" : status === "budget_exceeded" ? "budget_exceeded" : null;
    if (issueStatus) this.setIssueStatus(issueStatus);
  }

  private checkpoint(question: string, options?: string[], extra?: Record<string, unknown>) {
    const s = this.session;
    const m = addMessage(s.issue_id, "agent", { role: "assistant", content: question, meta: { checkpoint: true, options: options ?? [], state: s.state, ...extra } });
    emit({ type: "message.added", issueId: s.issue_id, thread: "agent", message: m as unknown as Record<string, unknown> });
    emit({ type: "checkpoint", issueId: s.issue_id, sessionId: s.id, question, ...(options && { options }) });
    const step = startStep({ session_id: s.id, state: s.state, kind: "checkpoint", title: "Waiting for answer", summary: question });
    finishStep(step.id, { status: "done" });
    emit({ type: "step.done", issueId: s.issue_id, sessionId: s.id, step: { id: step.id, seq: step.seq, state: s.state, kind: "checkpoint", title: step.title, summary: question } });
    this.pause("awaiting_user");
  }

  /** What the deploy approval block shows (14 §4): the latest applied patch in this session. */
  private approvalSummary(toolCallId: string) {
    const patch = listToolCallsForSession(this.session.id).filter((t) => t.tool === "git_branch_and_patch" && t.ok).at(-1);
    const diff = typeof (patch?.input as { patch?: unknown } | undefined)?.patch === "string" ? String((patch!.input as { patch: string }).patch) : null;
    const files = diff ? [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]!) : [];
    return { toolCallId, branch: `nsic/${getIssue(this.session.issue_id)?.key ?? ""}`, files, ...(diff && { diff: diff.slice(0, 20_000) }) };
  }

  private systemNote(content: string) {
    const s = this.session;
    const m = addMessage(s.issue_id, "agent", { role: "system_event", content });
    emit({ type: "message.added", issueId: s.issue_id, thread: "agent", message: m as unknown as Record<string, unknown> });
  }

  async run(): Promise<void> {
    const started = Date.now();
    emit({ type: "session.started", sessionId: this.sessionId, issueId: this.session.issue_id, state: this.session.state, status: "running" });
    for (let guard = 0; guard < 60; guard++) {
      if (this.signal.aborted) return this.pause("cancelled");
      const s = this.session;
      if (s.status !== "running") return;
      const lim = limits();
      if (Date.now() - started > lim.maxDurationMs) return this.checkpoint(`Session duration limit (${lim.maxDurationMs / 60000} min) reached. Continue investigating?`, ["Continue", "Enough, show summary"]);
      if (countToolCalls(s.id) >= lim.maxToolCalls) return this.checkpoint(`Limit of ${lim.maxToolCalls} tool calls per session reached. Continue with a new session?`, ["Continue", "Enough"]);
      const state = s.state as AgentState;
      try {
        const cont = await this.step(state);
        if (!cont) return;
      } catch (e) {
        this.log.error("state failed", { state, error: errorMessage(e) });
        this.systemNote(`Session failed in state ${state}: ${errorMessage(e)}`);
        return this.pause("failed", errorMessage(e));
      }
    }
  }

  /** Run a single state. Returns false if the session stops (pause/done). */
  private async step(state: AgentState): Promise<boolean> {
    const s = this.session;
    const issue = getIssue(s.issue_id)!;
    switch (state) {
      case "TRIAGE": {
        const st = startStep({ session_id: s.id, state, kind: "llm", title: "Triage" });
        emit({ type: "step.started", issueId: issue.id, sessionId: s.id, step: { id: st.id, seq: st.seq, state, kind: "llm", title: "Triage", summary: null } });
        const r = await runTriage(issue, { sessionId: s.id, stepId: st.id });
        if (!r.ok) {
          finishStep(st.id, { status: "failed", summary: r.error.message });
          if (r.error.code === "budget_exceeded") return this.onBudget(r.error.message);
          if (r.error.code === "llm_no_key") {
            this.systemNote(`No LLM is configured (${r.error.message}). The agent cannot run; local ingestion and code analysis are still available.`);
            this.pause("failed", r.error.message);
            return false;
          }
          throw new Error(r.error.message);
        }
        const summary = `${r.value.category} · ${r.value.severity} · ${r.value.module_area}. Plan: ${r.value.plan.join(" → ")}`;
        finishStep(st.id, { status: "done", summary });
        emit({ type: "step.done", issueId: issue.id, sessionId: s.id, step: { id: st.id, seq: st.seq, state, kind: "llm", title: "Triage", summary } });
        if (s.trigger === "monitor") {
          // Proactive monitoring: TRIAGE only, to keep cost down (07 §8).
          this.transition("AWAIT_USER", summary);
          this.pause("awaiting_user");
          return false;
        }
        this.transition("INVESTIGATE", summary);
        return true;
      }
      case "INVESTIGATE":
      case "HYPOTHESIZE":
      case "REPRODUCE":
      case "ROOT_CAUSE":
      case "FIX": {
        const before = Math.max(0, ...listHypotheses(issue.id).map((h) => h.confidence));
        const o = await this.toolLoop(state);
        if (state === "HYPOTHESIZE") this.trackHypothesisProgress(before);
        switch (o.kind) {
          case "transition":
            this.transition(o.next, o.summary);
            return true;
          case "checkpoint":
            this.checkpoint(o.question, o.options);
            return false;
          case "budget":
            return this.onBudget(o.message);
          case "error":
            throw new Error(o.message);
        }
        return false;
      }
      case "REPORT_DRAFT": {
        const st = startStep({ session_id: s.id, state, kind: "llm", title: "Root cause summary" });
        const r = await draftRootCause(issue, { sessionId: s.id, stepId: st.id }, this.escalated ? modelFor("agent_escalation") : modelFor("agent_main"));
        if (!r.ok) {
          finishStep(st.id, { status: "failed", summary: r.error.message });
          if (r.error.code === "budget_exceeded") return this.onBudget(r.error.message);
          throw new Error(r.error.message);
        }
        finishStep(st.id, { status: "done", summary: r.value.one_line });
        emit({ type: "step.done", issueId: issue.id, sessionId: s.id, step: { id: st.id, seq: st.seq, state, kind: "llm", title: "Root cause summary", summary: r.value.one_line } });
        const m = addMessage(issue.id, "agent", { role: "assistant", content: `**${r.value.one_line}**\n\n${r.value.root_cause_md}${r.value.recommended_next.length ? `\n\n**Next steps**\n${r.value.recommended_next.map((x) => `- ${x}`).join("\n")}` : ""}`, meta: { kind: "root_cause" } });
        emit({ type: "message.added", issueId: issue.id, thread: "agent", message: m as unknown as Record<string, unknown> });
        emit({ type: "issue.updated", issueId: issue.id, patch: { root_cause: getIssue(issue.id)?.root_cause, status: getIssue(issue.id)?.status } });
        this.transition("AWAIT_USER", r.value.one_line);
        this.pause("awaiting_user");
        return false;
      }
      case "AWAIT_USER":
      case "AWAIT_DEPLOY_APPROVAL":
        this.pause("awaiting_user");
        return false;
      case "CAPTURE": {
        const rs = listReproScripts(issue.id).find((r) => (r.dsl as { steps?: unknown[] }).steps?.length);
        if (!rs || !issue.environment_id) {
          this.checkpoint("No repro script or environment yet for the final capture. Write/update the repro script first?");
          return false;
        }
        enqueue("browser_run", { issueId: issue.id, environmentId: issue.environment_id, reproScriptId: rs.id, mode: "capture", recordVideo: true }, { priority: 7, maxAttempts: 1 });
        this.systemNote("Final capture scheduled: screenshot per step + video recording.");
        this.transition("DONE", "capture scheduled");
        return true;
      }
      case "VALIDATE": {
        const ctx = this.toolCtx(state, startStep({ session_id: s.id, state, kind: "tool", title: "Validation" }).id);
        const results: string[] = [];
        let failed = false;
        for (const name of ["run_tests", "sdf_validate"]) {
          const r = await executeTool(name, {}, ctx);
          if (r.ok) {
            results.push(`${name}: ${r.value.content.slice(0, 400)}`);
            const d = r.value.data as { ok?: boolean; exitCode?: number } | undefined;
            if (d && (d.ok === false || (d.exitCode !== undefined && d.exitCode !== 0))) failed = true;
          } else if (r.error.code !== "tool_blocked") {
            results.push(`${name}: ${r.error.message}`);
            failed = true;
          } else results.push(`${name}: skipped (${r.error.message})`);
        }
        finishStep(ctx.stepId, { status: failed ? "failed" : "done", summary: results.join("\n").slice(0, 1000) });
        if (failed) {
          this.transition("FIX", `validation failed: ${results.join("; ").slice(0, 400)}`);
          return true;
        }
        const pending = insertToolCall({ step_id: ctx.stepId, tool: "sdf_deploy_sandbox", risk: "remote_write_sandbox", input: { pending: true } });
        emit({ type: "approval.required", issueId: issue.id, toolCallId: pending.id, summary: "Deploy fix to sandbox" });
        this.transition("AWAIT_DEPLOY_APPROVAL", "validation passed, awaiting deploy approval");
        this.checkpoint("Validation passed. Approve deploy to sandbox?", ["Approve", "Reject"], { approval: this.approvalSummary(pending.id) });
        return false;
      }
      case "DEPLOY_SANDBOX": {
        this.systemNote("Sandbox deploy is run by the sdf_deploy_sandbox job after approval.");
        this.transition("VERIFY", "deploy scheduled");
        return true;
      }
      case "VERIFY": {
        const rs = listReproScripts(issue.id)[0];
        if (rs && issue.environment_id) enqueue("browser_run", { issueId: issue.id, environmentId: issue.environment_id, reproScriptId: rs.id, mode: "verify_after", recordVideo: true }, { priority: 7, maxAttempts: 1 });
        this.transition("DONE", "verify_after replay scheduled");
        return true;
      }
      case "DONE":
        this.pause("done");
        return false;
      case "BLOCKED":
      case "BUDGET_EXCEEDED":
        this.pause(state === "BLOCKED" ? "awaiting_user" : "budget_exceeded");
        return false;
    }
  }

  private onBudget(message: string): boolean {
    this.systemNote(`Issue budget exhausted: ${message}. Add budget then Resume.`);
    this.pause("budget_exceeded", message);
    return false;
  }

  /** Automatic escalation: two consecutive HYPOTHESIZE rounds without a confidence increase (05 §3). */
  private trackHypothesisProgress(before: number) {
    const after = Math.max(0, ...listHypotheses(this.session.issue_id).map((h) => h.confidence));
    this.hypothesisRounds.push(after - before);
    const last2 = this.hypothesisRounds.slice(-2);
    if (!this.escalated && last2.length === 2 && last2.every((d) => d <= 0)) {
      this.escalated = true;
      this.systemNote(`Automatic escalation to ${modelFor("agent_escalation")}: two hypothesis rounds without a confidence increase.`);
    }
  }

  private toolCtx(state: AgentState, stepId: string): Omit<ToolCtx, "toolCallId"> {
    const s = this.session;
    const issue = getIssue(s.issue_id)!;
    const env = issue.environment_id ? getEnvironment(issue.environment_id) : null;
    const profile = env ? latestAccessProfile(env.id) : null;
    const repoIds = listRepos(issue.project_id).filter((r) => r.last_indexed_at).map((r) => r.id);
    return { issue, session: s, env, profile, tier: profile?.tier ?? "none", state, stepId, repoIds, signal: this.signal };
  }

  private async toolLoop(state: AgentState): Promise<LoopOutcome> {
    const def = STATES[state]!;
    const s = this.session;
    const base = this.toolCtx(state, "");
    const tools = availableTools(ALL_TOOLS, base.env, base.profile, base.repoIds.length > 0).filter((t) => t.name !== "sdf_deploy_sandbox");
    const apiTools = toApiTools(tools);
    const system = systemBlocks(base.env, base.profile, tools, base.issue.project_id, base.repoIds);
    const model = this.escalated && ["HYPOTHESIZE", "ROOT_CAUSE", "FIX"].includes(state) ? modelFor("agent_escalation") : modelFor("agent_main");
    const directive = this.directive;
    this.directive = undefined;
    const messages: MessageParam[] = [{ role: "user", content: [{ type: "text", text: issueBoard(base.issue) }, { type: "text", text: stateInstruction(state, directive) }] }];
    let nudged = 0;

    for (let iter = 0; iter < def.maxIterations; iter++) {
      if (this.signal.aborted) return { kind: "error", message: "cancelled" };
      const st = startStep({ session_id: s.id, state, kind: "llm", title: `${STATE_LABEL[state]} · round ${iter + 1}` });
      emit({ type: "step.started", issueId: s.issue_id, sessionId: s.id, step: { id: st.id, seq: st.seq, state, kind: "llm", title: st.title, summary: null } });
      const r = await callLlm(
        { model, max_tokens: maxTokensFor(model === modelFor("agent_escalation") ? "agent_escalation" : "agent_main"), system, tools: apiTools, messages },
        { issueId: s.issue_id, sessionId: s.id, stepId: st.id, purpose: "agent" },
        { onText: (text) => emit({ type: "llm.delta", issueId: s.issue_id, sessionId: s.id, stepId: st.id, text }) },
      );
      if (!r.ok) {
        finishStep(st.id, { status: "failed", summary: r.error.message });
        emit({ type: "step.done", issueId: s.issue_id, sessionId: s.id, step: { id: st.id, seq: st.seq, state, kind: "llm", title: st.title, summary: r.error.message, status: "failed" } });
        return r.error.code === "budget_exceeded" ? { kind: "budget", message: r.error.message } : { kind: "error", message: r.error.message };
      }
      const resp = r.value;
      const uses = toolUses(resp);
      const narrative = textOf(resp).trim();
      const summary = narrative ? narrative.slice(0, 600) : uses.length ? `calling ${uses.map((u) => u.name).join(", ")}` : "(no output)";
      finishStep(st.id, { status: "done", summary });
      emit({ type: "step.done", issueId: s.issue_id, sessionId: s.id, step: { id: st.id, seq: st.seq, state, kind: "llm", title: st.title, summary } });
      messages.push({ role: "assistant", content: resp.content });

      if (resp.stop_reason === "max_tokens" && !uses.length) {
        messages.push({ role: "user", content: "Output truncated. Continue more concisely and use a tool." });
        continue;
      }
      if (!uses.length) {
        if (nudged++ >= 1) return { kind: "transition", next: def.next[0]!, summary: narrative.slice(0, 500) || "state finished without complete_state" };
        messages.push({ role: "user", content: `Continue working state ${state} using a tool, or call complete_state with next set to one of: ${def.next.join(", ")}.` });
        continue;
      }

      const results: ToolResultBlock[] = [];
      let outcome: LoopOutcome | null = null;
      for (const u of uses) {
        const sig = `${u.name}:${Bun.hash(JSON.stringify(u.input))}`;
        this.recentCalls.push(sig);
        const last3 = this.recentCalls.slice(-3);
        if (last3.length === 3 && last3.every((x) => x === sig) && u.name !== "complete_state") {
          results.push({ type: "tool_result", tool_use_id: u.id, content: "Identical tool call 3x in a row. Stopped (loop detected).", is_error: true });
          outcome ??= { kind: "transition", next: "HYPOTHESIZE", summary: `loop detected on ${u.name}; forcing HYPOTHESIZE` };
          continue;
        }
        const tst = startStep({ session_id: s.id, state, kind: "tool", title: u.name });
        emit({ type: "step.started", issueId: s.issue_id, sessionId: s.id, step: { id: tst.id, seq: tst.seq, state, kind: "tool", title: u.name, summary: null } });
        const tr = await executeTool(u.name, u.input, this.toolCtx(state, tst.id));
        const content = tr.ok ? tr.value.content : `ERROR (${tr.error.code}): ${tr.error.message}`;
        finishStep(tst.id, { status: tr.ok ? "done" : "failed", summary: content.slice(0, 400) });
        emit({ type: "step.done", issueId: s.issue_id, sessionId: s.id, step: { id: tst.id, seq: tst.seq, state, kind: "tool", title: u.name, summary: content.slice(0, 400), status: tr.ok ? "done" : "failed" } });
        results.push({ type: "tool_result", tool_use_id: u.id, content, ...(tr.ok ? {} : { is_error: true }) });
        if (tr.ok && tr.value.control && !outcome) {
          const c = tr.value.control;
          if (c.type === "checkpoint") outcome = { kind: "checkpoint", question: c.question, ...(c.options && { options: c.options }) };
          else if (c.type === "escalate") {
            this.escalated = true;
            this.systemNote(`Escalating to ${modelFor("agent_escalation")}: ${c.reason}`);
          } else if (c.type === "transition") {
            if (def.next.includes(c.next)) outcome = { kind: "transition", next: c.next, summary: c.summary };
            else results[results.length - 1] = { type: "tool_result", tool_use_id: u.id, content: `Transition to ${c.next} is not allowed from ${state}. Choose: ${def.next.join(", ")}`, is_error: true };
          }
        }
      }
      if (outcome) return outcome;
      messages.push({ role: "user", content: results as ContentBlock[] });
    }
    // Iterations exhausted: proceed to the default transition.
    const ev = listEvidence(s.issue_id).length;
    return { kind: "transition", next: def.next[0]!, summary: `limit of ${def.maxIterations} ${state} rounds reached (${ev} evidence)` };
  }
}

export async function runSession(sessionId: string, signal: AbortSignal, directive?: string) {
  const o = new Orchestrator(sessionId, signal, directive);
  await o.run();
}
