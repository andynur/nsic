import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { bool, buildPatch } from "./_util.ts";

export type Project = {
  id: string;
  name: string;
  client_name: string | null;
  key_prefix: string;
  auto_run_agent: boolean;
  default_budget_usd: number;
  notes: string | null;
  created_at: number;
  archived_at: number | null;
};

const map = (r: Record<string, unknown>): Project => ({ ...(r as unknown as Project), auto_run_agent: bool(r.auto_run_agent) });

export function listProjects(includeArchived = false): Project[] {
  const sql = `SELECT * FROM projects ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY name`;
  return (db().query(sql).all() as Record<string, unknown>[]).map(map);
}

export function getProject(id: string): Project | null {
  const r = db().query("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | null;
  return r ? map(r) : null;
}

export function createProject(input: {
  name: string;
  client_name?: string | null;
  key_prefix?: string;
  auto_run_agent?: boolean;
  default_budget_usd?: number;
  notes?: string | null;
}): Project {
  const id = newId();
  const prefix = (input.key_prefix ?? input.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 5) ?? "NS").toUpperCase() || "NS";
  db()
    .query(
      "INSERT INTO projects (id, name, client_name, key_prefix, auto_run_agent, default_budget_usd, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, input.name, input.client_name ?? null, prefix, input.auto_run_agent === false ? 0 : 1, input.default_budget_usd ?? 3, input.notes ?? null, now());
  return getProject(id)!;
}

export function updateProject(id: string, patch: Record<string, unknown>): Project | null {
  const { sets, vals } = buildPatch(patch, ["name", "client_name", "key_prefix", "auto_run_agent", "default_budget_usd", "notes", "archived_at"]);
  if (sets.length) db().query(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return getProject(id);
}

/** Atomic issue number allocation: 'ACME-42'. */
export function nextIssueKey(projectId: string): string {
  const r = db()
    .query("UPDATE projects SET next_issue_seq = next_issue_seq + 1 WHERE id = ? RETURNING key_prefix, next_issue_seq - 1 AS seq")
    .get(projectId) as { key_prefix: string; seq: number } | null;
  if (!r) throw new Error(`project ${projectId} does not exist`);
  return `${r.key_prefix}-${r.seq}`;
}
