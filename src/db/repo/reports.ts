import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { j, pj } from "./_util.ts";

export type ReportDraft = { id: string; issue_id: string; options: Record<string, unknown>; model: Record<string, unknown>; overrides: Record<string, string> | null; status: "draft" | "final"; created_at: number; finalized_at: number | null };
const map = (r: Record<string, unknown>): ReportDraft => ({ ...(r as unknown as ReportDraft), options: pj(r.options, {}), model: pj(r.model, {}), overrides: pj(r.overrides, null) });

export function insertReportDraft(d: { issue_id: string; options: unknown; model: unknown }): ReportDraft {
  const id = newId();
  db().query("INSERT INTO report_drafts (id, issue_id, options, model, status, created_at) VALUES (?, ?, ?, ?, 'draft', ?)").run(id, d.issue_id, JSON.stringify(d.options), JSON.stringify(d.model), now());
  return getReportDraft(id)!;
}
export function getReportDraft(id: string): ReportDraft | null {
  const r = db().query("SELECT * FROM report_drafts WHERE id = ?").get(id) as Record<string, unknown> | null;
  return r ? map(r) : null;
}
export function latestReportDraft(issueId: string): ReportDraft | null {
  const r = db().query("SELECT * FROM report_drafts WHERE issue_id = ? ORDER BY created_at DESC LIMIT 1").get(issueId) as Record<string, unknown> | null;
  return r ? map(r) : null;
}
export function updateReportDraft(id: string, p: { overrides?: Record<string, string>; status?: "draft" | "final"; model?: unknown }) {
  if (p.overrides) db().query("UPDATE report_drafts SET overrides = ? WHERE id = ?").run(j(p.overrides), id);
  if (p.model) db().query("UPDATE report_drafts SET model = ? WHERE id = ?").run(j(p.model), id);
  if (p.status) db().query("UPDATE report_drafts SET status = ?, finalized_at = ? WHERE id = ?").run(p.status, p.status === "final" ? now() : null, id);
  return getReportDraft(id);
}

export function putOauthState(state: string, envId: string, verifier: string) {
  db().query("DELETE FROM oauth_states WHERE created_at < ?").run(now() - 15 * 60_000);
  db().query("INSERT INTO oauth_states (state, environment_id, code_verifier, created_at) VALUES (?, ?, ?, ?)").run(state, envId, verifier, now());
}
export function takeOauthState(state: string): { environment_id: string; code_verifier: string } | null {
  const r = db().query("DELETE FROM oauth_states WHERE state = ? AND created_at > ? RETURNING environment_id, code_verifier").get(state, now() - 15 * 60_000) as { environment_id: string; code_verifier: string } | null;
  return r;
}
