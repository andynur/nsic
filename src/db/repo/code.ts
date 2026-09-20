import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { buildPatch, pj } from "./_util.ts";
import { ftsQuery } from "./issues.ts";

export type Repo = {
  id: string;
  project_id: string;
  source: "local_path" | "git_url";
  location: string;
  default_branch: string | null;
  sdf_root: string | null;
  project_type: "ACCOUNTCUSTOMIZATION" | "SUITEAPP" | "NONE" | null;
  last_indexed_commit: string | null;
  last_indexed_at: number | null;
};

export const listRepos = (projectId: string): Repo[] => db().query("SELECT * FROM repos WHERE project_id = ?").all(projectId) as Repo[];
export const getRepo = (id: string): Repo | null => db().query("SELECT * FROM repos WHERE id = ?").get(id) as Repo | null;

export function createRepo(r: { project_id: string; source: Repo["source"]; location: string; default_branch?: string | null }): Repo {
  const id = newId();
  db().query("INSERT INTO repos (id, project_id, source, location, default_branch) VALUES (?, ?, ?, ?, ?)").run(id, r.project_id, r.source, r.location, r.default_branch ?? null);
  return getRepo(id)!;
}

export function updateRepo(id: string, patch: Partial<Repo>) {
  const { sets, vals } = buildPatch(patch as Record<string, unknown>, ["location", "default_branch", "sdf_root", "project_type", "last_indexed_commit", "last_indexed_at"]);
  if (sets.length) db().query(`UPDATE repos SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export const deleteRepo = (id: string) => {
  db().query("DELETE FROM code_fts WHERE repo_id = ?").run(id);
  db().query("DELETE FROM repos WHERE id = ?").run(id);
};

export type CodeFile = {
  id: string;
  repo_id: string;
  path: string;
  sha256: string;
  kind: string;
  script_type: string | null;
  api_version: string | null;
  modules: string[];
  entry_points: string[];
  size_bytes: number | null;
};

const mapFile = (r: Record<string, unknown>): CodeFile => ({ ...(r as unknown as CodeFile), modules: pj(r.modules, []), entry_points: pj(r.entry_points, []) });

export const fileShas = (repoId: string): Map<string, { id: string; sha256: string }> =>
  new Map((db().query("SELECT id, path, sha256 FROM code_files WHERE repo_id = ?").all(repoId) as { id: string; path: string; sha256: string }[]).map((r) => [r.path, r]));

export function upsertCodeFile(f: Omit<CodeFile, "id">, content: string): string {
  const existing = db().query("SELECT id FROM code_files WHERE repo_id = ? AND path = ?").get(f.repo_id, f.path) as { id: string } | null;
  const id = existing?.id ?? newId();
  db()
    .query(
      `INSERT INTO code_files (id, repo_id, path, sha256, kind, script_type, api_version, modules, entry_points, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo_id, path) DO UPDATE SET sha256=excluded.sha256, kind=excluded.kind, script_type=excluded.script_type, api_version=excluded.api_version,
         modules=excluded.modules, entry_points=excluded.entry_points, size_bytes=excluded.size_bytes`,
    )
    .run(id, f.repo_id, f.path, f.sha256, f.kind, f.script_type, f.api_version, JSON.stringify(f.modules), JSON.stringify(f.entry_points), f.size_bytes);
  db().query("DELETE FROM code_fts WHERE file_id = ?").run(id);
  db().query("INSERT INTO code_fts (path, content, repo_id, file_id) VALUES (?, ?, ?, ?)").run(f.path, content, f.repo_id, id);
  return id;
}

export function removeCodeFile(repoId: string, path: string) {
  const r = db().query("SELECT id FROM code_files WHERE repo_id = ? AND path = ?").get(repoId, path) as { id: string } | null;
  if (!r) return;
  db().query("DELETE FROM code_fts WHERE file_id = ?").run(r.id);
  db().query("DELETE FROM code_files WHERE id = ?").run(r.id);
  db().query("DELETE FROM code_edges WHERE repo_id = ? AND (src = ? OR dst = ?)").run(repoId, `file:${path}`, `file:${path}`);
}

export const listCodeFiles = (repoId: string): CodeFile[] =>
  (db().query("SELECT * FROM code_files WHERE repo_id = ? ORDER BY path").all(repoId) as Record<string, unknown>[]).map(mapFile);

export function upsertSdfObject(o: { repo_id: string; scriptid: string; object_type: string; file_path: string; attrs: Record<string, unknown> }) {
  db()
    .query(
      `INSERT INTO sdf_objects (id, repo_id, scriptid, object_type, file_path, attrs) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo_id, scriptid) DO UPDATE SET object_type=excluded.object_type, file_path=excluded.file_path, attrs=excluded.attrs`,
    )
    .run(newId(), o.repo_id, o.scriptid, o.object_type, o.file_path, JSON.stringify(o.attrs));
}

export const deleteSdfObjectsForFile = (repoId: string, filePath: string) => {
  const objs = db().query("SELECT scriptid FROM sdf_objects WHERE repo_id = ? AND file_path = ?").all(repoId, filePath) as { scriptid: string }[];
  for (const o of objs) db().query("DELETE FROM code_edges WHERE repo_id = ? AND src = ?").run(repoId, `obj:${o.scriptid}`);
  db().query("DELETE FROM sdf_objects WHERE repo_id = ? AND file_path = ?").run(repoId, filePath);
};

export type SdfObject = { id: string; repo_id: string; scriptid: string; object_type: string; file_path: string; attrs: Record<string, unknown> };
export const listSdfObjects = (repoId: string): SdfObject[] =>
  (db().query("SELECT * FROM sdf_objects WHERE repo_id = ? ORDER BY object_type, scriptid").all(repoId) as Record<string, unknown>[]).map((r) => ({ ...(r as unknown as SdfObject), attrs: pj(r.attrs, {}) }));

export function addEdge(repoId: string, src: string, dst: string, rel: string) {
  db().query("INSERT OR IGNORE INTO code_edges (repo_id, src, dst, rel) VALUES (?, ?, ?, ?)").run(repoId, src, dst, rel);
}
export const clearFileEdges = (repoId: string, path: string) => db().query("DELETE FROM code_edges WHERE repo_id = ? AND src = ?").run(repoId, `file:${path}`);

export type Edge = { src: string; dst: string; rel: string };
export const edgesFrom = (repoId: string, src: string): Edge[] => db().query("SELECT src, dst, rel FROM code_edges WHERE repo_id = ? AND src = ?").all(repoId, src) as Edge[];
export const edgesTo = (repoId: string, dst: string, rel?: string): Edge[] =>
  (rel ? db().query("SELECT src, dst, rel FROM code_edges WHERE repo_id = ? AND dst = ? AND rel = ?").all(repoId, dst, rel) : db().query("SELECT src, dst, rel FROM code_edges WHERE repo_id = ? AND dst = ?").all(repoId, dst)) as Edge[];

export type CodeHit = { path: string; repo_id: string; file_id: string; snippet: string; rank: number };
export function searchCode(repoIds: string[], q: string, limit = 20): CodeHit[] {
  if (!repoIds.length) return [];
  const ph = repoIds.map(() => "?").join(",");
  const sql = `SELECT path, repo_id, file_id, snippet(code_fts, 1, '«', '»', ' … ', 24) AS snippet, rank FROM code_fts WHERE code_fts MATCH ? AND repo_id IN (${ph}) ORDER BY rank LIMIT ?`;
  const all = db().query(sql).all(ftsQuery(q), ...repoIds, limit) as CodeHit[];
  if (all.length) return all;
  // fallback: any token matches (OR), ordered by bm25
  const any = ftsQuery(q).split(" ").join(" OR ");
  return db().query(sql).all(any, ...repoIds, limit) as CodeHit[];
}

export const repoStats = (repoId: string) =>
  db().query("SELECT (SELECT COUNT(*) FROM code_files WHERE repo_id = ?1) AS files, (SELECT COUNT(*) FROM sdf_objects WHERE repo_id = ?1) AS objects, (SELECT COUNT(*) FROM code_edges WHERE repo_id = ?1) AS edges").get(repoId) as { files: number; objects: number; edges: number };

export { now };
