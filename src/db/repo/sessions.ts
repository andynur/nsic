import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { bool, buildPatch, j, pj } from "./_util.ts";

export type SessionTrigger = "auto" | "chat" | "capture" | "verify" | "fix" | "manual" | "monitor";
export type SessionStatus = "running" | "awaiting_user" | "done" | "failed" | "cancelled" | "budget_exceeded";
export type AgentSession = {
  id: string;
  issue_id: string;
  trigger: SessionTrigger;
  state: string;
  status: SessionStatus;
  access_profile_id: string | null;
  model_main: string;
  started_at: number;
  ended_at: number | null;
  error: string | null;
};

export type StepKind = "llm" | "tool" | "checkpoint" | "transition" | "note";
export type AgentStep = {
  id: string;
  session_id: string;
  seq: number;
  state: string;
  kind: StepKind;
  title: string | null;
  summary: string | null;
  idempotency_key: string | null;
  status: "running" | "done" | "failed" | "skipped";
  started_at: number;
  ended_at: number | null;
};

export type ToolRisk = "read" | "local_write" | "remote_write_sandbox" | "blocked";
export type ToolCallRow = {
  id: string;
  step_id: string;
  tool: string;
  risk: ToolRisk;
  input: unknown;
  output_path: string | null;
  output_preview: string | null;
  ok: boolean | null;
  duration_ms: number | null;
  approved_by_user: boolean;
};

export function createSession(s: { issue_id: string; trigger: SessionTrigger; state: string; model_main: string; access_profile_id?: string | null }): AgentSession {
  const id = newId();
  db()
    .query("INSERT INTO agent_sessions (id, issue_id, trigger, state, status, access_profile_id, model_main, started_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?)")
    .run(id, s.issue_id, s.trigger, s.state, s.access_profile_id ?? null, s.model_main, now());
  return getSession(id)!;
}

export const getSession = (id: string): AgentSession | null => db().query("SELECT * FROM agent_sessions WHERE id = ?").get(id) as AgentSession | null;

export const listSessions = (issueId: string): AgentSession[] =>
  db().query("SELECT * FROM agent_sessions WHERE issue_id = ? ORDER BY started_at DESC").all(issueId) as AgentSession[];

export const activeSession = (issueId: string): AgentSession | null =>
  db().query("SELECT * FROM agent_sessions WHERE issue_id = ? AND status IN ('running','awaiting_user','budget_exceeded') ORDER BY started_at DESC LIMIT 1").get(issueId) as AgentSession | null;

export function updateSession(id: string, patch: Partial<Pick<AgentSession, "state" | "status" | "ended_at" | "error" | "model_main">>) {
  const p: Record<string, unknown> = { ...patch };
  if (p.status && ["done", "failed", "cancelled"].includes(p.status as string) && p.ended_at === undefined) p.ended_at = now();
  const { sets, vals } = buildPatch(p, ["state", "status", "ended_at", "error", "model_main"]);
  if (sets.length) db().query(`UPDATE agent_sessions SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function startStep(s: { session_id: string; state: string; kind: StepKind; title?: string; summary?: string; idempotency_key?: string }): AgentStep {
  if (s.idempotency_key) {
    const ex = db().query("SELECT * FROM agent_steps WHERE idempotency_key = ?").get(s.idempotency_key) as AgentStep | null;
    if (ex) return ex;
  }
  const id = newId();
  const seq = (db().query("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM agent_steps WHERE session_id = ?").get(s.session_id) as { n: number }).n;
  db()
    .query("INSERT INTO agent_steps (id, session_id, seq, state, kind, title, summary, idempotency_key, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)")
    .run(id, s.session_id, seq, s.state, s.kind, s.title ?? null, s.summary ?? null, s.idempotency_key ?? null, now());
  return getStep(id)!;
}

export const getStep = (id: string): AgentStep | null => db().query("SELECT * FROM agent_steps WHERE id = ?").get(id) as AgentStep | null;

export function finishStep(id: string, patch: { status?: AgentStep["status"]; summary?: string; title?: string }) {
  const { sets, vals } = buildPatch({ status: patch.status ?? "done", ...patch, ended_at: now() }, ["status", "summary", "title", "ended_at"]);
  db().query(`UPDATE agent_steps SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return getStep(id)!;
}

export const listSteps = (sessionId: string, afterSeq = 0): AgentStep[] =>
  db().query("SELECT * FROM agent_steps WHERE session_id = ? AND seq > ? ORDER BY seq").all(sessionId, afterSeq) as AgentStep[];

export const recentStepSummaries = (issueId: string, limit = 10): { state: string; title: string | null; summary: string | null }[] =>
  (db()
    .query(`SELECT st.state, st.title, st.summary FROM agent_steps st JOIN agent_sessions s ON s.id = st.session_id
            WHERE s.issue_id = ? AND st.summary IS NOT NULL ORDER BY st.started_at DESC LIMIT ?`)
    .all(issueId, limit) as { state: string; title: string | null; summary: string | null }[]).reverse();

const mapTool = (r: Record<string, unknown>): ToolCallRow => ({
  ...(r as unknown as ToolCallRow),
  input: pj(r.input, {}),
  ok: r.ok === null ? null : bool(r.ok),
  approved_by_user: bool(r.approved_by_user),
});

export function insertToolCall(t: { step_id: string; tool: string; risk: ToolRisk; input: unknown }): ToolCallRow {
  const id = newId();
  db().query("INSERT INTO tool_calls (id, step_id, tool, risk, input) VALUES (?, ?, ?, ?, ?)").run(id, t.step_id, t.tool, t.risk, j(t.input) ?? "{}");
  return getToolCall(id)!;
}

export function getToolCall(id: string): ToolCallRow | null {
  const r = db().query("SELECT * FROM tool_calls WHERE id = ?").get(id) as Record<string, unknown> | null;
  return r ? mapTool(r) : null;
}

export function finishToolCall(id: string, p: { ok: boolean; output_preview?: string; output_path?: string | null; duration_ms: number; approved_by_user?: boolean }) {
  db()
    .query("UPDATE tool_calls SET ok = ?, output_preview = ?, output_path = ?, duration_ms = ?, approved_by_user = COALESCE(?, approved_by_user) WHERE id = ?")
    .run(p.ok ? 1 : 0, p.output_preview ?? null, p.output_path ?? null, p.duration_ms, p.approved_by_user === undefined ? null : p.approved_by_user ? 1 : 0, id);
}

export const listToolCallsForSession = (sessionId: string): ToolCallRow[] =>
  (db().query("SELECT tc.* FROM tool_calls tc JOIN agent_steps st ON st.id = tc.step_id WHERE st.session_id = ? ORDER BY st.seq").all(sessionId) as Record<string, unknown>[]).map(mapTool);

export const countToolCalls = (sessionId: string): number =>
  (db().query("SELECT COUNT(*) AS n FROM tool_calls tc JOIN agent_steps st ON st.id = tc.step_id WHERE st.session_id = ?").get(sessionId) as { n: number }).n;
