// In-memory API handler for static UI mode. Same contract as docs/13-api-spec.md; never touches the backend.
import { dashboardFixture } from "./dashboard.ts";
import * as F from "./fixtures.ts";
import type { Issue, Message, Step } from "../types.ts";

type Emit = (ev: Record<string, unknown> & { type: string }) => void;
type Ctx = { params: Record<string, string>; query: URLSearchParams; body: unknown; emit: Emit };
type H = (c: Ctx) => unknown | Promise<unknown>;

const fail = (status: number, code: string, message: string) => {
  throw { status, code, message };
};
const byIdOrKey = (id: string) => F.issues.find((i) => i.id === id || i.key === id) ?? fail(404, "not_found", "issue not found");
const later = (ms: number, fn: () => void) => setTimeout(fn, ms);
let seq = 1000;
const nid = (p: string) => `${p}-${++seq}`;

const messages: Record<string, Message[]> = { "i-42": [...F.messages42], "i-46": [...F.messages46] };
const consultant: Record<string, Message[]> = { "i-42": [...F.consultant42] };
const extraSteps: Record<string, Step[]> = {};

/** Agent simulation: steps, streaming deltas, events, then a checkpoint. */
function simulateRun(issue: Issue, emit: Emit, directive: string) {
  const sid = issue.id === "i-42" ? "s-42" : `s-${issue.id}`;
  const list = (extraSteps[sid] ??= []);
  const s = F.detailFor(issue.id).activeSession;
  if (s) {
    s.status = "running";
    s.state = "INVESTIGATE";
  }
  F.sessionState[issue.id] = "INVESTIGATE";
  issue.status = "investigating";
  emit({ type: "session.state", issueId: issue.id, sessionId: sid, state: "INVESTIGATE", status: "running" });
  const stepId = nid("st");
  const t0 = Date.now();
  const text = `Following direction: ${directive.slice(0, 80)}. Checking the approval workflow on vendorbill and the afterSubmit execution order.`;
  let k = 0;
  const tick = setInterval(() => {
    k += 12;
    emit({ type: "llm.delta", issueId: issue.id, sessionId: sid, stepId, text: text.slice(k - 12, k) });
    if (k >= text.length) clearInterval(tick);
  }, 60);
  later(1800, () => {
    list.push({ id: stepId, seq: 100 + list.length, state: "INVESTIGATE", kind: "llm", title: "investigating · new direction", summary: text, status: "done", started_at: t0, ended_at: Date.now(), usage: { calls: 1, input_tokens: 1320, output_tokens: 240, cache_write_tokens: 0, cache_read_tokens: 21680, cost_usd: 0.0091 }, toolCalls: [] });
    emit({ type: "step.done", issueId: issue.id, sessionId: sid, step: { id: stepId } });
  });
  later(2600, () => {
    list.push({ id: nid("st"), seq: 100 + list.length, state: "INVESTIGATE", kind: "tool", title: "read_code", summary: "src/Objects/customworkflow_acme_vb_approval.xml (lines 1-24 of 24)\nThe workflow only sets APPROVALSTATUS in BEFORESUBMIT; it does not re-save the record.", status: "done", started_at: Date.now() - 400, ended_at: Date.now(), usage: null, toolCalls: [{ id: nid("tc"), tool: "read_code", risk: "read", input: { path: "src/Objects/customworkflow_acme_vb_approval.xml" }, output_preview: "<workflow scriptid=\"customworkflow_acme_vb_approval\">\n  <recordtypes>VENDORBILL</recordtypes>\n  ...", ok: true, duration_ms: 6 }] });
    emit({ type: "step.done", issueId: issue.id, sessionId: sid, step: {} });
  });
  later(3600, () => {
    if (s) {
      s.status = "awaiting_user";
      s.state = "AWAIT_USER";
    }
    F.sessionState[issue.id] = null;
    issue.status = issue.evidence_level >= 4 ? "root_caused" : "awaiting_user";
    const m: Message = { id: nid("m"), role: "assistant", content: "The approval workflow only changes the status in beforeSubmit and doesn't re-save the record, so it isn't contributing to the conflict. Conclusion unchanged: two afterSubmit user events (#E4, #E5).", html: "<p>The approval workflow only changes the status in beforeSubmit and doesn't re-save the record, so it isn't contributing to the conflict. Conclusion unchanged: two afterSubmit user events (#E4, #E5).</p>", meta: null, created_at: Date.now() };
    (messages[issue.id] ??= []).push(m);
    emit({ type: "message.added", issueId: issue.id, thread: "agent", message: m });
    emit({ type: "session.state", issueId: issue.id, sessionId: sid, state: "AWAIT_USER", status: "awaiting_user" });
  });
}

const routes: [string, string, H][] = [
  ["GET", "/api/dashboard", ({ query }) => dashboardFixture(Number(query.get("days") ?? 30), query.get("project"))],
  ["GET", "/api/projects", () => F.projects.map((p) => ({ ...p, environments: F.envs.filter((e) => e.project_id === p.id).map((e) => ({ ...e, tier: e.profile?.tier ?? "none" })), repos: F.repos.filter((r) => r.project_id === p.id) }))],
  ["POST", "/api/projects", ({ body }) => {
    const b = body as { name: string; client_name?: string; key_prefix?: string; default_budget_usd?: number };
    const p = { id: nid("p"), name: b.name, client_name: b.client_name ?? null, key_prefix: (b.key_prefix ?? b.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 5)).toUpperCase(), auto_run_agent: true, default_budget_usd: b.default_budget_usd ?? 3, notes: null, created_at: Date.now(), archived_at: null };
    F.projects.push(p);
    return p;
  }],
  ["GET", "/api/projects/:id", ({ params }) => F.projectDetail(params.id!)],
  ["POST", "/api/projects/:id/environments", ({ params, body }) => {
    const b = body as { name: string; kind: string; account_id: string; timezone: string };
    const host = b.account_id.toLowerCase().replace(/_/g, "-");
    const e = { ...F.envs[2]!, id: nid("e"), project_id: params.id!, name: b.name, kind: b.kind, account_id: b.account_id, timezone: b.timezone, ui_base_url: `https://${host}.app.netsuite.com`, mcp_url: `https://${host}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools`, automation_consent_at: null, profile: null, credentials: [], monitor_enabled: false, created_at: Date.now() };
    e.capabilityTable = F.envs[2]!.capabilityTable.map((c) => ({ ...c, available: false }));
    F.envs.push(e);
    return e;
  }],
  ["POST", "/api/projects/:id/repos", ({ params, body }) => {
    const b = body as { source: string; location: string };
    const r = { id: nid("r"), project_id: params.id!, source: b.source, location: b.location, sdf_root: null, project_type: null, last_indexed_at: null, last_indexed_commit: null, stats: { files: 0, objects: 0, edges: 0 } };
    F.repos.push(r);
    return r;
  }],
  ["POST", "/api/repos/:id/index", ({ params, emit }) => {
    const r = F.repos.find((x) => x.id === params.id);
    later(1200, () => {
      if (r) Object.assign(r, { last_indexed_at: Date.now(), sdf_root: "src", project_type: "ACCOUNTCUSTOMIZATION", stats: { files: 42, objects: 18, edges: 96 } });
      emit({ type: "job.done", jobType: "index_repo", jobId: "j" });
    });
    return { id: nid("job"), status: "queued" };
  }],
  ["GET", "/api/environments/:id", ({ params }) => F.envs.find((e) => e.id === params.id) ?? fail(404, "not_found", "environment not found")],
  ["PATCH", "/api/environments/:id", ({ params, body }) => {
    const e = F.envs.find((x) => x.id === params.id) ?? fail(404, "not_found", "environment not found");
    const b = body as Record<string, unknown> & { automation_consent?: { given: boolean } };
    const { automation_consent, ...rest } = b;
    Object.assign(e, rest);
    if (automation_consent) e.automation_consent_at = automation_consent.given ? Date.now() : null;
    return e;
  }],
  ["POST", "/api/environments/:id/probe", ({ params, emit }) => {
    later(1500, () => {
      const e = F.envs.find((x) => x.id === params.id);
      if (e && e.profile) e.profile.probed_at = Date.now();
      emit({ type: "env.updated", environmentId: params.id!, projectId: e?.project_id ?? "" });
      emit({ type: "job.done", jobType: "probe_env", jobId: "j" });
    });
    return { id: nid("job"), status: "queued" };
  }],
  ["POST", "/api/environments/:id/oauth/start", ({ params }) => {
    const e = F.envs.find((x) => x.id === params.id);
    if (!e?.automation_consent_at) fail(409, "consent_required", "Record the client's automation consent first (wizard step 2)");
    return { authorizeUrl: "about:blank#static-mode-oauth" };
  }],
  ["POST", "/api/environments/:id/m2m/keypair", () => ({ certificatePem: F.SAMPLE_PEM })],
  ["PUT", "/api/environments/:id/m2m", () => ({ ok: true })],
  ["PUT", "/api/environments/:id/sdf", () => ({ ok: true })],
  ["POST", "/api/environments/:id/login-assist/start", () => ({ pid: 1 })],
  ["POST", "/api/environments/:id/login-assist/finish", () => ({ loggedIn: true, url: "https://1234567-sb1.app.netsuite.com/app/center/card.nl" })],
  ["POST", "/api/environments/:id/terminal", ({ emit }) => {
    const id = nid("term");
    const lines = ["\r\nSuiteCloud CLI for Node.js 3.1.0\r\n", "? Select or create an authentication ID (authID):\r\n", "  > Create a new authentication ID (authID)\r\n", "    acme-sb1 | 1234567_SB1 | NSIC Integration\r\n"];
    lines.forEach((l, k) => later(300 * (k + 1), () => emit({ type: "terminal.data", terminalId: id, data: l })));
    return { terminalId: id };
  }],
  ["GET", "/api/issues", ({ query }) => {
    let rows = F.issueRows();
    const q = query.get("q")?.toLowerCase();
    if (q) rows = rows.filter((r) => `${r.key} ${r.title} ${r.description}`.toLowerCase().includes(q));
    if (query.get("project")) rows = rows.filter((r) => r.project_id === query.get("project"));
    if (query.get("status")) rows = rows.filter((r) => r.status === query.get("status"));
    if (query.get("envKind")) rows = rows.filter((r) => r.env_kind === query.get("envKind"));
    if (query.get("open") === "1") rows = rows.filter((r) => !["resolved", "closed", "cancelled"].includes(r.status));
    return rows;
  }],
  ["POST", "/api/issues", ({ body, emit }) => {
    const fd = body as FormData;
    const project = F.projects.find((p) => p.id === fd.get("projectId")) ?? fail(422, "validation", "Project is required");
    const n = F.issues.filter((i) => i.project_id === project.id).length + 40;
    const issue: Issue = { id: nid("i"), key: `${project.key_prefix}-${n + 10}`, project_id: project.id, environment_id: (fd.get("environmentId") as string) || null, title: String(fd.get("title")), description: String(fd.get("description") ?? ""), reporter: (fd.get("reporter") as string) || null, priority: String(fd.get("priority") ?? "normal"), status: "ingesting", category: null, severity: null, module_area: null, evidence_level: 0, root_cause: null, resolution: null, budget_usd: fd.get("budgetUsd") ? Number(fd.get("budgetUsd")) : null, triage: null, questions_for_client: null, created_at: Date.now(), updated_at: Date.now() };
    F.issues.push(issue);
    F.sessionState[issue.id] = null;
    later(1500, () => {
      issue.status = "investigating";
      issue.evidence_level = 1;
      F.sessionState[issue.id] = "TRIAGE";
      emit({ type: "issue.updated", issueId: issue.id, patch: { status: "investigating" } });
    });
    return issue;
  }],
  ["GET", "/api/issues/:id", ({ params }) => {
    const d = F.detailFor(params.id!);
    d.issue = byIdOrKey(params.id!);
    return d;
  }],
  ["PATCH", "/api/issues/:id", ({ params, body }) => {
    const i = byIdOrKey(params.id!);
    const b = body as Record<string, unknown> & { add_budget_usd?: number };
    if (b.add_budget_usd) i.budget_usd = (i.budget_usd ?? F.projects.find((p) => p.id === i.project_id)!.default_budget_usd) + b.add_budget_usd;
    const { add_budget_usd: _a, ...rest } = b;
    Object.assign(i, rest, { updated_at: Date.now() });
    return i;
  }],
  ["PATCH", "/api/entities/:id", ({ body }) => ({ ok: true, ...(body as object) })],
  ["PATCH", "/api/evidence/:id", ({ params, body }) => {
    const e = F.detailFor("i-42").evidence.find((x) => x.id === params.id);
    if (e) Object.assign(e, body as object);
    return e ?? { ok: true };
  }],
  ["POST", "/api/issues/:id/entities", ({ body }) => ({ id: nid("en"), ...(body as object), status: "manual" })],
  ["GET", "/api/sessions/:id/steps", ({ params }) => {
    const base = F.stepsFor(params.id!);
    const steps = [...base, ...(extraSteps[params.id!] ?? [])];
    const totals = steps.reduce((t, s) => (s.usage ? { calls: t.calls + 1, input_tokens: t.input_tokens + s.usage.input_tokens, output_tokens: t.output_tokens + s.usage.output_tokens, cache_write_tokens: t.cache_write_tokens + s.usage.cache_write_tokens, cache_read_tokens: t.cache_read_tokens + s.usage.cache_read_tokens, cost_usd: t.cost_usd + s.usage.cost_usd } : t), { calls: 0, input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, cost_usd: 0 });
    return { session: { id: params.id }, totals, steps };
  }],
  ["POST", "/api/sessions/:id/cancel", ({ params, emit }) => {
    const i = F.issues.find((x) => `s-${x.id}` === params.id || (params.id === "s-42" && x.id === "i-42"));
    if (i) {
      F.sessionState[i.id] = null;
      const s = F.detailFor(i.id).activeSession;
      if (s) s.status = "cancelled";
      emit({ type: "session.ended", issueId: i.id, sessionId: params.id, status: "cancelled" });
    }
    return { ok: true };
  }],
  ["POST", "/api/sessions/:id/resume", ({ params, emit }) => {
    const i = F.issues.find((x) => `s-${x.id}` === params.id || (params.id === "s-42" && x.id === "i-42"));
    if (i) simulateRun(i, emit, "continue investigation");
    return { ok: true };
  }],
  ["POST", "/api/issues/:id/sessions", ({ params, body, emit }) => {
    const i = byIdOrKey(params.id!);
    const b = body as { state?: string };
    if (b.state === "CAPTURE") {
      const m: Message = { id: nid("m"), role: "system_event", content: "Final capture scheduled: per-step screenshots + video recording.", html: "", meta: null, created_at: Date.now() };
      (messages[i.id] ??= []).push(m);
      emit({ type: "message.added", issueId: i.id, thread: "agent", message: m });
      return { ok: true };
    }
    simulateRun(i, emit, b.state === "FIX" ? "draft a fix on branch nsic/" + i.key : "re-run investigation");
    return { ok: true };
  }],
  ["POST", "/api/approvals/:id", ({ params, body, emit }) => {
    if (params.id !== F.approval46.toolCallId) fail(409, "no_pending_approval", "There is no approval waiting");
    const i = byIdOrKey("i-46");
    if (i.status !== "fixing") fail(409, "no_pending_approval", "There is no approval waiting");
    const approve = (body as { approve: boolean }).approve;
    const note = (text: string) => {
      const m: Message = { id: nid("m"), role: "system_event", content: text, html: "", meta: null, created_at: Date.now() };
      messages[i.id]!.push(m);
      emit({ type: "message.added", issueId: i.id, thread: "agent", message: m });
    };
    if (!approve) {
      i.status = "awaiting_user";
      note("Deploy rejected. The agent is waiting for new direction.");
      emit({ type: "session.state", issueId: i.id, sessionId: "s-i-46", state: "AWAIT_USER", status: "awaiting_user" });
      return { ok: true };
    }
    i.status = "verifying";
    F.sessionState[i.id] = "VERIFY";
    note("Deploy approved. Deploying to SB1, then replaying the repro script.");
    emit({ type: "session.state", issueId: i.id, sessionId: "s-i-46", state: "VERIFY", status: "running" });
    later(2500, () => {
      i.status = "resolved";
      i.evidence_level = 5;
      F.sessionState[i.id] = null;
      note("Verification passed: SG invoices now print the SG tax number (E5).");
      emit({ type: "session.ended", issueId: i.id, sessionId: "s-i-46", status: "done" });
    });
    return { ok: true };
  }],
  ["GET", "/api/issues/:id/threads/:kind/messages", ({ params }) => {
    const i = byIdOrKey(params.id!);
    const list = params.kind === "consultant" ? consultant[i.id] ?? [] : messages[i.id] ?? [];
    return list.map((m) => ({ ...m, html: m.html || F.mdToHtml(m.content) }));
  }],
  ["POST", "/api/issues/:id/threads/:kind/messages", ({ params, body, emit }) => {
    const i = byIdOrKey(params.id!);
    const content = String((body as { content: string }).content);
    const m: Message = { id: nid("m"), role: "user", content, html: F.mdToHtml(content), meta: null, created_at: Date.now() };
    (messages[i.id] ??= []).push(m);
    const cmd = /^\/(\w+)/.exec(content)?.[1];
    const sys = (text: string) => {
      const s: Message = { id: nid("m"), role: "system_event", content: text, html: "", meta: null, created_at: Date.now() };
      messages[i.id]!.push(s);
      emit({ type: "message.added", issueId: i.id, thread: "agent", message: s });
    };
    if (cmd === "stop") sys("Session stopped.");
    else if (cmd === "capture") sys(i.evidence_level >= 3 ? "Final capture started." : `Final capture requires at least E3 evidence (currently E${i.evidence_level}).`);
    else if (cmd === "fix") sys("Agent is starting to draft a fix on a branch.");
    else if (cmd === "verify") sys("Verification replay scheduled.");
    else if (/#?E\d+\s*(correct|wrong|confirm|reject)/i.test(content)) sys("Evidence updated.");
    else if (content.trim().endsWith("?")) later(900, () => {
      const a: Message = { id: nid("m"), role: "assistant", content: "", html: "<p>Proven: two afterSubmit user events save the same bill (#E4, #E5) and the symptom was reproduced in SB1 (#E6). Not yet known: whether production has the same deploy order.</p>", meta: { intent: "question" }, created_at: Date.now() };
      messages[i.id]!.push(a);
      emit({ type: "message.added", issueId: i.id, thread: "agent", message: a });
    });
    else simulateRun(i, emit, content);
    return { message: m, intent: { intent: cmd ? "command" : "directive" } };
  }],
  ["POST", "/api/issues/:id/threads/consultant/draft", ({ params, body }) => {
    const i = byIdOrKey(params.id!);
    const b = body as { question: string; modifier?: string; tone?: string; length?: string };
    const list = (consultant[i.id] ??= []);
    list.push({ id: nid("c"), role: "user", content: b.question, html: "", meta: {}, created_at: Date.now() });
    const answer =
      b.modifier === "shorter" ? "Found the cause: two automated scripts save the bill at the same time. The fix is being tested in sandbox; release schedule to follow."
      : b.modifier === "translate" ? "We found the cause: two automated scripts save the same bill at almost the same time, so NetSuite rejects the save with \"Record has been changed\". The fix will be tested in sandbox first, and we will share the release schedule once it passes verification."
      : b.tone === "formal" || b.modifier === "more_formal" ? "The cause of the issue has been identified: two automated scripts update the same vendor bill at nearly the same time, causing NetSuite to reject the save with the message \"Record has been changed\". The fix will first be tested in sandbox, and we will inform you of the production release schedule once verification is complete."
      : "We found the cause: during approval, two automated scripts modify the same bill almost at the same time, so NetSuite rejects the save with \"Record has been changed\". The fix will be tested in sandbox first; once it passes, I'll share the release schedule.";
    const m: Message = { id: nid("c"), role: "assistant", content: answer, html: "", meta: { question: b.question, cited: ["#E4", "#E5", "#E6"], confidence_note: "ETA not yet set by the developer.", held: false, violations: [], faq: false }, created_at: Date.now() };
    list.push(m);
    return m;
  }],
  ["POST", "/api/messages/:id/faq", ({ params, body }) => {
    for (const list of Object.values(consultant)) {
      const m = list.find((x) => x.id === params.id);
      if (m) m.meta = { ...(m.meta ?? {}), faq: (body as { faq: boolean }).faq };
    }
    return { ok: true };
  }],
  ["POST", "/api/issues/:id/reports", ({ params, body }) => ({ id: nid("draft"), issue_id: byIdOrKey(params.id!).id, status: "draft", options: body, created_at: Date.now() })],
  ["PATCH", "/api/reports/:id", () => ({ ok: true })],
  ["POST", "/api/reports/:id/finalize", ({ emit }) => {
    later(1200, () => emit({ type: "job.done", jobType: "build_report", jobId: "j", issueId: "i-42" }));
    return { id: nid("job"), status: "queued" };
  }],
  ["GET", "/api/usage", () => F.usageFixture()],
  ["GET", "/api/settings/models", () => F.settingsFixture.models],
  ["PUT", "/api/settings/models", ({ body }) => Object.assign(F.settingsFixture.models, body)],
  ["GET", "/api/settings/llm", () => F.settingsFixture.llm],
  ["PUT", "/api/settings/llm", ({ body }) => {
    const next = body as { engine: "api" | "claude-code" | "codex"; models: typeof F.settingsFixture.models };
    F.settingsFixture.llm.engine = next.engine;
    Object.assign(F.settingsFixture.llm.profiles[next.engine], next.models);
    return F.settingsFixture.llm;
  }],
  ["GET", "/api/settings/pricing", () => F.settingsFixture.pricing],
  ["PUT", "/api/settings/pricing", ({ body }) => (F.settingsFixture.pricing = body as typeof F.settingsFixture.pricing)],
  ["GET", "/api/settings/general", () => F.settingsFixture.general],
  ["PUT", "/api/settings/general", ({ body }) => Object.assign(F.settingsFixture.general, body)],
  ["GET", "/api/system/check", () => F.settingsFixture.check],
];

const compiled = routes.map(([method, path, h]) => ({ method, pattern: new URLPattern({ pathname: path }), h }));

export async function mockRequest(method: string, url: string, body: unknown, emit: Emit): Promise<unknown> {
  const u = new URL(url, location.origin);
  for (const r of compiled) {
    if (r.method !== method) continue;
    const m = r.pattern.exec({ pathname: u.pathname });
    if (!m) continue;
    await new Promise((res) => setTimeout(res, 120 + Math.random() * 120)); // latency so the loading state is visible
    return structuredClone(await r.h({ params: m.pathname.groups as Record<string, string>, query: u.searchParams, body, emit }));
  }
  throw { status: 404, code: "not_found", message: `Static mode: ${method} ${u.pathname} has no sample data yet` };
}

export const mockArtifactSrc = (id: string): string | null => F.mockSrc[id] ?? null;
