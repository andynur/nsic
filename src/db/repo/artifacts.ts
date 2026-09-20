import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { bool, j, pj } from "./_util.ts";

export type ArtifactKind = "screenshot" | "video" | "captions" | "trace" | "report_pdf" | "report_xlsx" | "report_md" | "bundle_zip" | "diff" | "log";
export type Artifact = {
  id: string;
  issue_id: string;
  run_id: string | null;
  kind: ArtifactKind;
  step_index: number | null;
  caption: string | null;
  storage_path: string;
  mime: string;
  size_bytes: number | null;
  redacted: boolean;
  created_at: number;
};

const map = (r: Record<string, unknown>): Artifact => ({ ...(r as unknown as Artifact), redacted: bool(r.redacted) });

export function insertArtifact(a: Omit<Artifact, "id" | "created_at">): Artifact {
  const id = newId();
  db()
    .query("INSERT INTO artifacts (id, issue_id, run_id, kind, step_index, caption, storage_path, mime, size_bytes, redacted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, a.issue_id, a.run_id, a.kind, a.step_index, a.caption, a.storage_path, a.mime, a.size_bytes, a.redacted ? 1 : 0, now());
  return getArtifact(id)!;
}

export function getArtifact(id: string): Artifact | null {
  const r = db().query("SELECT * FROM artifacts WHERE id = ?").get(id) as Record<string, unknown> | null;
  return r ? map(r) : null;
}

export function listArtifacts(issueId: string, kind?: string): Artifact[] {
  const rows = kind
    ? db().query("SELECT * FROM artifacts WHERE issue_id = ? AND kind = ? ORDER BY created_at, step_index").all(issueId, kind)
    : db().query("SELECT * FROM artifacts WHERE issue_id = ? ORDER BY created_at, step_index").all(issueId);
  return (rows as Record<string, unknown>[]).map(map);
}

export const listRunArtifacts = (runId: string): Artifact[] =>
  (db().query("SELECT * FROM artifacts WHERE run_id = ? ORDER BY step_index, created_at").all(runId) as Record<string, unknown>[]).map(map);

// ── Repro scripts & browser runs ──
export type ReproScript = { id: string; issue_id: string; version: number; environment_id: string | null; dsl: unknown; author: "agent" | "user"; created_at: number };
const mapRs = (r: Record<string, unknown>): ReproScript => ({ ...(r as unknown as ReproScript), dsl: pj(r.dsl, {}) });

export function insertReproScript(r: { issue_id: string; environment_id: string | null; dsl: unknown; author: "agent" | "user" }): ReproScript {
  const id = newId();
  db().transaction(() => {
    const v = (db().query("SELECT COALESCE(MAX(version),0)+1 AS v FROM repro_scripts WHERE issue_id = ?").get(r.issue_id) as { v: number }).v;
    db().query("INSERT INTO repro_scripts (id, issue_id, version, environment_id, dsl, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, r.issue_id, v, r.environment_id, JSON.stringify(r.dsl), r.author, now());
  })();
  return getReproScript(id)!;
}
export function getReproScript(id: string): ReproScript | null {
  const r = db().query("SELECT * FROM repro_scripts WHERE id = ?").get(id) as Record<string, unknown> | null;
  return r ? mapRs(r) : null;
}
export const listReproScripts = (issueId: string): ReproScript[] =>
  (db().query("SELECT * FROM repro_scripts WHERE issue_id = ? ORDER BY version DESC").all(issueId) as Record<string, unknown>[]).map(mapRs);

export type RunMode = "explore" | "reproduce" | "capture" | "verify_before" | "verify_after";
export type RunStatus = "running" | "passed" | "failed" | "blocked" | "cancelled";
export type BrowserRun = {
  id: string;
  issue_id: string;
  repro_script_id: string | null;
  mode: RunMode;
  environment_id: string;
  record_video: boolean;
  status: RunStatus;
  result: Record<string, unknown> | null;
  started_at: number;
  ended_at: number | null;
};
const mapRun = (r: Record<string, unknown>): BrowserRun => ({ ...(r as unknown as BrowserRun), record_video: bool(r.record_video), result: pj(r.result, null) });

export function insertRun(r: { issue_id: string; repro_script_id: string | null; mode: RunMode; environment_id: string; record_video: boolean }): BrowserRun {
  const id = newId();
  db()
    .query("INSERT INTO browser_runs (id, issue_id, repro_script_id, mode, environment_id, record_video, status, started_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)")
    .run(id, r.issue_id, r.repro_script_id, r.mode, r.environment_id, r.record_video ? 1 : 0, now());
  return getRun(id)!;
}
export function getRun(id: string): BrowserRun | null {
  const r = db().query("SELECT * FROM browser_runs WHERE id = ?").get(id) as Record<string, unknown> | null;
  return r ? mapRun(r) : null;
}
export const listRuns = (issueId: string): BrowserRun[] =>
  (db().query("SELECT * FROM browser_runs WHERE issue_id = ? ORDER BY started_at DESC").all(issueId) as Record<string, unknown>[]).map(mapRun);
export function finishRun(id: string, status: RunStatus, result: Record<string, unknown>) {
  db().query("UPDATE browser_runs SET status = ?, result = ?, ended_at = ? WHERE id = ?").run(status, j(result), now(), id);
}
