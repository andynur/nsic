import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { buildPatch, j, pj } from "./_util.ts";
import { nextIssueKey } from "./projects.ts";

export const ISSUE_STATUSES = [
  "draft", "ingesting", "investigating", "awaiting_user", "reproduced", "root_caused",
  "fixing", "verifying", "resolved", "closed", "blocked", "budget_exceeded", "cancelled",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type Triage = {
  category: string;
  severity: string;
  module_area: string;
  suspected_record_types: string[];
  plan: string[];
  missing_info: string[];
};

export type Issue = {
  id: string;
  project_id: string;
  environment_id: string | null;
  key: string;
  title: string;
  description: string;
  reporter: string | null;
  priority: Priority;
  status: IssueStatus;
  category: string | null;
  severity: string | null;
  module_area: string | null;
  evidence_level: number;
  root_cause: string | null;
  resolution: string | null;
  budget_usd: number | null;
  triage: Triage | null;
  questions_for_client: string[] | null;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
};

const map = (r: Record<string, unknown>): Issue => ({
  ...(r as unknown as Issue),
  triage: pj<Triage | null>(r.triage, null),
  questions_for_client: pj<string[] | null>(r.questions_for_client, null),
});

function syncFts(id: string) {
  const i = getIssue(id);
  db().query("DELETE FROM issues_fts WHERE issue_id = ?").run(id);
  if (i) db().query("INSERT INTO issues_fts (title, description, root_cause, resolution, issue_id) VALUES (?, ?, ?, ?, ?)").run(i.title, i.description, i.root_cause ?? "", i.resolution ?? "", id);
}

export function getIssue(id: string): Issue | null {
  const r = db().query("SELECT * FROM issues WHERE id = ?").get(id) as Record<string, unknown> | null;
  return r ? map(r) : null;
}

export function getIssueByKeyOrId(keyOrId: string): Issue | null {
  const r = db().query("SELECT * FROM issues WHERE id = ?1 OR key = ?1").get(keyOrId) as Record<string, unknown> | null;
  return r ? map(r) : null;
}

export type IssueListRow = Issue & {
  project_name: string;
  env_name: string | null;
  env_kind: string | null;
  cost_usd: number | null;
  session_state: string | null;
};

export function listIssues(f: { projectId?: string; status?: string; q?: string; open?: boolean; envKind?: string; limit?: number }): IssueListRow[] {
  const where: string[] = [];
  const vals: (string | number)[] = [];
  if (f.projectId) (where.push("i.project_id = ?"), vals.push(f.projectId));
  if (f.status) (where.push("i.status = ?"), vals.push(f.status));
  if (f.envKind) (where.push("e.kind = ?"), vals.push(f.envKind));
  if (f.open) where.push("i.status NOT IN ('resolved','closed','cancelled')");
  if (f.q && f.q.trim()) {
    where.push("(i.id IN (SELECT issue_id FROM issues_fts WHERE issues_fts MATCH ?) OR i.key LIKE ?)");
    vals.push(ftsQuery(f.q), `%${f.q.trim()}%`);
  }
  const sql = `
    SELECT i.*, p.name AS project_name, e.name AS env_name, e.kind AS env_kind, u.cost_usd,
      (SELECT s.state FROM agent_sessions s WHERE s.issue_id = i.id AND s.status IN ('running','awaiting_user') ORDER BY s.started_at DESC LIMIT 1) AS session_state
    FROM issues i
    JOIN projects p ON p.id = i.project_id
    LEFT JOIN environments e ON e.id = i.environment_id
    LEFT JOIN v_issue_usage u ON u.issue_id = i.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY i.updated_at DESC LIMIT ?`;
  vals.push(f.limit ?? 500);
  return (db().query(sql).all(...vals) as Record<string, unknown>[]).map((r) => ({ ...map(r), ...(r as object) }) as IssueListRow);
}

/** Turn free-form input into a safe FTS5 query: each token is quoted, prefix match. */
export function ftsQuery(q: string): string {
  const toks = q.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (!toks.length) return '""';
  return toks.map((t) => `"${t}"*`).join(" ");
}

export function createIssue(input: {
  project_id: string;
  environment_id?: string | null;
  title: string;
  description?: string;
  reporter?: string | null;
  priority?: Priority;
  budget_usd?: number | null;
  status?: IssueStatus;
}): Issue {
  const id = newId();
  const t = now();
  db().transaction(() => {
    const key = nextIssueKey(input.project_id);
    db()
      .query(
        "INSERT INTO issues (id, project_id, environment_id, key, title, description, reporter, priority, status, budget_usd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.project_id, input.environment_id ?? null, key, input.title, input.description ?? "", input.reporter ?? null, input.priority ?? "normal", input.status ?? "draft", input.budget_usd ?? null, t, t);
  })();
  syncFts(id);
  return getIssue(id)!;
}

const PATCHABLE = ["title", "description", "reporter", "priority", "status", "category", "severity", "module_area", "evidence_level", "root_cause", "resolution", "budget_usd", "environment_id", "triage", "questions_for_client", "resolved_at"] as const;

export function updateIssue(id: string, patch: Partial<Record<(typeof PATCHABLE)[number], unknown>>): Issue | null {
  const p: Record<string, unknown> = { ...patch };
  if (p.status === "resolved" && p.resolved_at === undefined) p.resolved_at = now();
  const { sets, vals } = buildPatch(p, PATCHABLE, ["triage", "questions_for_client"]);
  if (!sets.length) return getIssue(id);
  db().query(`UPDATE issues SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, now(), id);
  if (["title", "description", "root_cause", "resolution"].some((k) => k in p)) syncFts(id);
  return getIssue(id);
}

export function deleteIssue(id: string) {
  db().transaction(() => {
    db().query("DELETE FROM issues_fts WHERE issue_id = ?").run(id);
    db().query("DELETE FROM issue_memory_fts WHERE issue_id = ?").run(id);
    db().query("DELETE FROM llm_calls WHERE issue_id = ?").run(id);
    db().query("DELETE FROM issues WHERE id = ?").run(id);
  })();
}

/** evidence_level = highest level of non-rejected evidence (05 §2). */
export function recomputeEvidenceLevel(issueId: string): number {
  const r = db().query("SELECT COALESCE(MAX(level), 0) AS lvl FROM evidence WHERE issue_id = ? AND status != 'rejected'").get(issueId) as { lvl: number };
  db().query("UPDATE issues SET evidence_level = ?, updated_at = ? WHERE id = ?").run(r.lvl, now(), issueId);
  return r.lvl;
}

export const effectiveBudget = (issueId: string): number => {
  const r = db().query("SELECT COALESCE(i.budget_usd, p.default_budget_usd) AS b FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = ?").get(issueId) as { b: number } | null;
  return r?.b ?? 3;
};

export { j };
