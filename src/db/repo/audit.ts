import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { j, pj } from "./_util.ts";

export type AuditActor = "user" | "agent" | "system";
export type AuditEntry = { id: string; at: number; actor: AuditActor; action: string; environment_id: string | null; issue_id: string | null; detail: Record<string, unknown> | null };

export function audit(actor: AuditActor, action: string, ctx: { environmentId?: string | null; issueId?: string | null; detail?: Record<string, unknown> } = {}) {
  db()
    .query("INSERT INTO audit_log (id, at, actor, action, environment_id, issue_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(newId(), now(), actor, action, ctx.environmentId ?? null, ctx.issueId ?? null, j(ctx.detail));
}

export function listAudit(f: { issueId?: string; environmentId?: string; action?: string; limit?: number } = {}): AuditEntry[] {
  const w: string[] = [];
  const v: (string | number)[] = [];
  if (f.issueId) (w.push("issue_id = ?"), v.push(f.issueId));
  if (f.environmentId) (w.push("environment_id = ?"), v.push(f.environmentId));
  if (f.action) (w.push("action LIKE ?"), v.push(f.action.replace("*", "%")));
  v.push(f.limit ?? 200);
  return (db().query(`SELECT * FROM audit_log ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY at DESC LIMIT ?`).all(...v) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as AuditEntry),
    detail: pj(r.detail, null),
  }));
}
