// Chat agent thread (11 §1): intent classification → answer / resume / update evidence / command (05 §7).
import { s } from "../lib/schema.ts";
import { type Result, ok, appErr } from "../lib/result.ts";
import { llmAvailable } from "../llm/anthropic.ts";
import { addMessage, type Message } from "../db/repo/threads.ts";
import { getIssue, recomputeEvidenceLevel } from "../db/repo/issues.ts";
import { listEvidence, updateEvidence } from "../db/repo/evidence.ts";
import { activeSession, updateSession } from "../db/repo/sessions.ts";
import { getEnvironment, latestAccessProfile } from "../db/repo/environments.ts";
import { cancelJobsFor } from "../db/repo/jobs.ts";
import { callLlm, callStructured } from "../llm/client.ts";
import { maxTokensFor, modelFor } from "../llm/models.ts";
import { textOf } from "../llm/types.ts";
import { emit } from "../realtime/events.ts";
import { dispatcher } from "../jobs/dispatcher.ts";
import { issueBoard } from "./context.ts";
import { startAgentSession } from "./start.ts";

export const Intent = s.object({
  intent: s.enum(["question", "directive", "feedback_evidence", "command"] as const),
  command: s.enum(["capture", "fix", "verify", "stop", "export", "resume"] as const).optional(),
  evidence_updates: s.array(s.object({ ref: s.string().describe("e.g. E12 or #E12"), status: s.enum(["confirmed", "rejected"] as const) }), { max: 20 }).optional(),
  directive: s.string({ max: 2000 }).optional(),
});
export type IntentT = { intent: "question" | "directive" | "feedback_evidence" | "command"; command?: "capture" | "fix" | "verify" | "stop" | "export" | "resume"; evidence_updates?: { ref: string; status: "confirmed" | "rejected" }[]; directive?: string };

/** Heuristic without an LLM (also used for explicit commands like '/capture' etc.). Keeps localized confirmation/rejection synonyms in the regex below intentionally; this is matching logic, not displayed UI text. */
export function heuristicIntent(text: string): IntentT | null {
  const t = text.trim();
  const cmd = /^\/(capture|fix|verify|stop|export|resume)\b/i.exec(t);
  if (cmd) return { intent: "command", command: cmd[1]!.toLowerCase() as IntentT["command"] };
  const ev = [...t.matchAll(/#?E(\d+)\s*(?:=|:)?\s*(confirm(?:ed)?|benar|valid|reject(?:ed)?|salah|tolak)/gi)];
  if (ev.length) return { intent: "feedback_evidence", evidence_updates: ev.map((m) => ({ ref: `E${m[1]}`, status: /confirm|benar|valid/i.test(m[2]!) ? "confirmed" : "rejected" })) };
  return null;
}

export async function classifyIntent(issueId: string, text: string): Promise<IntentT> {
  const h = heuristicIntent(text);
  if (h) return h;
  if (!llmAvailable()) return /\?\s*$/.test(text.trim()) ? { intent: "question" } : { intent: "directive", directive: text };
  const r = await callStructured(
    {
      model: modelFor("intent"),
      max_tokens: maxTokensFor("intent"),
      system: `Classify the developer's message to the NetSuite investigation agent.
question: asking about findings/status (answer from the evidence board).
directive: a new investigation instruction ("check the approval workflow", "reproduce using the AP Clerk role").
feedback_evidence: confirming/rejecting evidence (#E3 correct, E5 wrong).
command: an explicit capture/fix/verify/stop/export/resume action.
Fill directive with a brief rephrased instruction when intent=directive.`,
      messages: [{ role: "user", content: text }],
      tool: { name: "record_intent", description: "Record the message intent.", input_schema: Intent.json() },
    },
    { issueId, purpose: "other" },
    (v) => Intent.parse(v),
  );
  return r.ok ? (r.value as IntentT) : { intent: "directive", directive: text };
}

const say = (issueId: string, role: Message["role"], content: string, meta?: Record<string, unknown>) => {
  const m = addMessage(issueId, "agent", { role, content, ...(meta && { meta }) });
  emit({ type: "message.added", issueId, thread: "agent", message: m as unknown as Record<string, unknown> });
  return m;
};

export async function postAgentMessage(issueId: string, text: string): Promise<Result<{ message: Message; intent: IntentT }>> {
  const issue = getIssue(issueId);
  if (!issue) return appErr("not_found", "issue not found");
  const userMsg = say(issueId, "user", text);
  const intent = await classifyIntent(issueId, text);
  const session = activeSession(issueId);

  switch (intent.intent) {
    case "question": {
      if (!llmAvailable()) {
        say(issueId, "assistant", "No LLM is configured. Choose a working engine in Settings so the question can be answered automatically.");
        break;
      }
      const r = await callLlm(
        {
          model: modelFor("agent_main"),
          max_tokens: 2000,
          system: "Answer the developer's question about this issue using only the evidence board. Reference evidence with #E. Distinguish proven, suspected, and unknown. Concise, English, no em dashes.",
          messages: [{ role: "user", content: `${issueBoard(issue)}\n\nQuestion: ${text}` }],
        },
        { issueId, purpose: "agent" },
      );
      say(issueId, "assistant", r.ok ? textOf(r.value) : `Failed to answer: ${r.error.message}`, { intent: "question" });
      break;
    }
    case "feedback_evidence": {
      const ev = listEvidence(issueId);
      const done: string[] = [];
      for (const u of intent.evidence_updates ?? []) {
        const seq = Number(u.ref.replace(/[^0-9]/g, ""));
        const e = ev.find((x) => x.seq === seq);
        if (e) {
          const upd = updateEvidence(e.id, { status: u.status });
          emit({ type: "evidence.updated", issueId, evidence: upd as unknown as Record<string, unknown> });
          done.push(`#E${seq} ${u.status}`);
        }
      }
      const lvl = recomputeEvidenceLevel(issueId);
      emit({ type: "issue.updated", issueId, patch: { evidence_level: lvl } });
      say(issueId, "system_event", done.length ? `Evidence updated: ${done.join(", ")}. Issue level E${lvl}.` : "No evidence matched the reference.");
      if (done.some((d) => d.includes("rejected")) && session?.status === "awaiting_user") startAgentSession(issueId, "chat", { state: "HYPOTHESIZE", directive: `User rejected evidence: ${done.join(", ")}. Adjust the hypotheses.` });
      break;
    }
    case "command":
      return runCommand(issueId, intent, userMsg);
    case "directive": {
      const directive = intent.directive ?? text;
      if (session?.status === "running") say(issueId, "system_event", "Instruction recorded; the agent will read it on the next round.");
      else {
        startAgentSession(issueId, "chat", { state: "INVESTIGATE", directive });
        say(issueId, "system_event", "The agent is continuing the investigation with a new instruction.");
      }
      break;
    }
  }
  return ok({ message: userMsg, intent });
}

async function runCommand(issueId: string, intent: IntentT, userMsg: Message): Promise<Result<{ message: Message; intent: IntentT }>> {
  const issue = getIssue(issueId)!;
  const session = activeSession(issueId);
  const env = issue.environment_id ? getEnvironment(issue.environment_id) : null;
  const tier = env ? latestAccessProfile(env.id)?.tier ?? "none" : "none";
  switch (intent.command) {
    case "stop":
      if (session) {
        for (const j of cancelJobsFor("sessionId", session.id)) dispatcher()?.cancel(j.id);
        updateSession(session.id, { status: "cancelled" });
        emit({ type: "session.ended", sessionId: session.id, issueId, status: "cancelled" });
      }
      say(issueId, "system_event", "Session stopped.");
      break;
    case "capture":
      if (issue.evidence_level < 3) say(issueId, "system_event", `Final capture needs at least E3 evidence (currently E${issue.evidence_level}).`);
      else {
        startAgentSession(issueId, "capture", { state: "CAPTURE" });
        say(issueId, "system_event", "Final capture started.");
      }
      break;
    case "fix":
      if (!env || env.kind !== "sandbox" || !["A", "B"].includes(tier)) say(issueId, "system_event", "Fix is only available for a sandbox environment with tier A/B.");
      else {
        startAgentSession(issueId, "fix", { state: "FIX" });
        say(issueId, "system_event", "Agent is starting to build the fix on a branch.");
      }
      break;
    case "verify":
      startAgentSession(issueId, "verify", { state: "VERIFY" });
      say(issueId, "system_event", "Verification replay scheduled.");
      break;
    case "resume":
      startAgentSession(issueId, "chat");
      say(issueId, "system_event", "Session resumed.");
      break;
    case "export":
      say(issueId, "system_event", "Open the Report page to choose format and audience, then Finalize.");
      break;
  }
  return ok({ message: userMsg, intent });
}
