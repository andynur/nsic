import { db } from "../db.ts";
import { now } from "../../lib/ids.ts";
import { ftsQuery } from "./issues.ts";

export type IssueMemory = { issue_id: string; project_id: string; symptoms: string; root_cause: string; fix_summary: string | null; files: string | null; error_codes: string | null; created_at: number };

export function upsertMemory(m: Omit<IssueMemory, "created_at">) {
  db().transaction(() => {
    db().query("DELETE FROM issue_memory WHERE issue_id = ?").run(m.issue_id);
    db().query("DELETE FROM issue_memory_fts WHERE issue_id = ?").run(m.issue_id);
    db().query("INSERT INTO issue_memory (issue_id, project_id, symptoms, root_cause, fix_summary, files, error_codes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(m.issue_id, m.project_id, m.symptoms, m.root_cause, m.fix_summary, m.files, m.error_codes, now());
    db().query("INSERT INTO issue_memory_fts (symptoms, root_cause, fix_summary, error_codes, issue_id) VALUES (?, ?, ?, ?, ?)").run(m.symptoms, m.root_cause, m.fix_summary ?? "", m.error_codes ?? "", m.issue_id);
  })();
}

export function findSimilar(q: string, excludeIssueId?: string, limit = 3) {
  const toks = (q.match(/[\p{L}\p{N}_]{3,}/gu) ?? []).slice(0, 12);
  if (!toks.length) return [];
  const match = toks.map((t) => `"${t}"`).join(" OR ");
  return db()
    .query(
      `SELECT m.issue_id, i.key, i.title, m.symptoms, m.root_cause, m.fix_summary, m.error_codes FROM issue_memory_fts f
       JOIN issue_memory m ON m.issue_id = f.issue_id JOIN issues i ON i.id = m.issue_id
       WHERE issue_memory_fts MATCH ? AND m.issue_id != ? ORDER BY f.rank LIMIT ?`,
    )
    .all(match, excludeIssueId ?? "", limit) as { issue_id: string; key: string; title: string; symptoms: string; root_cause: string; fix_summary: string | null; error_codes: string | null }[];
}

export { ftsQuery };
