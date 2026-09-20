import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { j } from "./_util.ts";

export type LlmPurpose = "ingest" | "triage" | "agent" | "consultant" | "report" | "summarize" | "probe" | "other";
export type LlmCall = {
  id: string;
  issue_id: string | null;
  session_id: string | null;
  step_id: string | null;
  purpose: LlmPurpose;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  pricing_snapshot: unknown;
  latency_ms: number | null;
  stop_reason: string | null;
  request_id: string | null;
  created_at: number;
};

export function insertLlmCall(c: Omit<LlmCall, "id" | "created_at">): LlmCall {
  const id = newId();
  db()
    .query(
      `INSERT INTO llm_calls (id, issue_id, session_id, step_id, purpose, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, pricing_snapshot, latency_ms, stop_reason, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, c.issue_id, c.session_id, c.step_id, c.purpose, c.model, c.input_tokens, c.output_tokens, c.cache_write_tokens, c.cache_read_tokens, c.cost_usd, j(c.pricing_snapshot), c.latency_ms, c.stop_reason, c.request_id, now());
  return db().query("SELECT * FROM llm_calls WHERE id = ?").get(id) as LlmCall;
}

export type UsageTotals = { calls: number; input_tokens: number; output_tokens: number; cache_write_tokens: number; cache_read_tokens: number; cost_usd: number };
const ZERO: UsageTotals = { calls: 0, input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, cost_usd: 0 };
const TOT = `COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
  COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens, COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens, COALESCE(ROUND(SUM(cost_usd),6),0) AS cost_usd`;

export const issueTotals = (issueId: string): UsageTotals => (db().query(`SELECT ${TOT} FROM llm_calls WHERE issue_id = ?`).get(issueId) as UsageTotals) ?? ZERO;
export const sessionTotals = (sessionId: string): UsageTotals => (db().query(`SELECT ${TOT} FROM llm_calls WHERE session_id = ?`).get(sessionId) as UsageTotals) ?? ZERO;
export const stepTotals = (stepId: string): UsageTotals => (db().query(`SELECT ${TOT} FROM llm_calls WHERE step_id = ?`).get(stepId) as UsageTotals) ?? ZERO;

export const issueByPurpose = (issueId: string) =>
  db().query(`SELECT purpose, ${TOT} FROM llm_calls WHERE issue_id = ? GROUP BY purpose ORDER BY cost_usd DESC`).all(issueId) as (UsageTotals & { purpose: string })[];

export const issueCalls = (issueId: string): LlmCall[] => db().query("SELECT * FROM llm_calls WHERE issue_id = ? ORDER BY created_at").all(issueId) as LlmCall[];

export const stepUsageForSession = (sessionId: string) =>
  db().query(`SELECT step_id, ${TOT} FROM llm_calls WHERE session_id = ? AND step_id IS NOT NULL GROUP BY step_id`).all(sessionId) as (UsageTotals & { step_id: string })[];

export function usageReport(f: { from: number; to: number; projectId?: string }) {
  const pf = f.projectId ? "AND i.project_id = ?3" : "";
  const args: (string | number)[] = [f.from, f.to];
  if (f.projectId) args.push(f.projectId);
  const base = `FROM llm_calls c LEFT JOIN issues i ON i.id = c.issue_id WHERE c.created_at >= ?1 AND c.created_at < ?2 ${pf}`;
  return {
    totals: (db().query(`SELECT ${TOT.replaceAll("SUM(", "SUM(c.")} , COUNT(DISTINCT c.issue_id) AS issues ${base}`).get(...args) as UsageTotals & { issues: number }),
    byIssue: db().query(`SELECT c.issue_id, i.key, i.title, ${TOT.replaceAll("SUM(", "SUM(c.")} ${base} GROUP BY c.issue_id ORDER BY cost_usd DESC LIMIT 200`).all(...args),
    byModel: db().query(`SELECT c.model, ${TOT.replaceAll("SUM(", "SUM(c.")} ${base} GROUP BY c.model ORDER BY cost_usd DESC`).all(...args),
    byPurpose: db().query(`SELECT c.purpose, ${TOT.replaceAll("SUM(", "SUM(c.")} ${base} GROUP BY c.purpose ORDER BY cost_usd DESC`).all(...args),
    daily: db().query(`SELECT strftime('%Y-%m-%d', c.created_at / 1000, 'unixepoch', 'localtime') AS day, ${TOT.replaceAll("SUM(", "SUM(c.")} ${base} GROUP BY day ORDER BY day`).all(...args),
  };
}
