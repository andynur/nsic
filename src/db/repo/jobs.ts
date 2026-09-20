import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { pj } from "./_util.ts";

export const JOB_TYPES = ["ingest", "index_repo", "probe_env", "agent_session", "browser_run", "record_video", "build_report", "sdf_deploy_sandbox", "poll_logs", "memory"] as const;
export type JobType = (typeof JOB_TYPES)[number];
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type Job = {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  priority: number;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  lease_until: number | null;
  pid: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

const map = (r: Record<string, unknown>): Job => ({ ...(r as unknown as Job), payload: pj(r.payload, {}) });

export function enqueue(type: JobType, payload: Record<string, unknown>, opts: { priority?: number; maxAttempts?: number } = {}): Job {
  const id = newId();
  const t = now();
  db()
    .query("INSERT INTO jobs (id, type, payload, priority, status, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)")
    .run(id, type, JSON.stringify(payload), opts.priority ?? 5, opts.maxAttempts ?? 3, t, t);
  return getJob(id)!;
}

export function getJob(id: string): Job | null {
  const r = db().query("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | null;
  return r ? map(r) : null;
}

export const queuedJobs = (limit = 20): Job[] =>
  (db().query("SELECT * FROM jobs WHERE status = 'queued' ORDER BY priority DESC, created_at LIMIT ?").all(limit) as Record<string, unknown>[]).map(map);

export const runningJobs = (): Job[] => (db().query("SELECT * FROM jobs WHERE status = 'running'").all() as Record<string, unknown>[]).map(map);

/** Atomic claim: only succeeds if the job is still queued. */
export function claimJob(id: string, leaseMs: number): boolean {
  const r = db()
    .query("UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_until = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
    .run(now() + leaseMs, now(), id);
  return r.changes === 1;
}

export const setJobPid = (id: string, pid: number) => db().query("UPDATE jobs SET pid = ? WHERE id = ?").run(pid, id);
export const heartbeat = (id: string, leaseMs: number) => db().query("UPDATE jobs SET lease_until = ?, updated_at = ? WHERE id = ? AND status = 'running'").run(now() + leaseMs, now(), id);

export function finishJob(id: string, status: "done" | "failed" | "cancelled", error?: string) {
  db().query("UPDATE jobs SET status = ?, last_error = ?, lease_until = NULL, updated_at = ? WHERE id = ?").run(status, error ?? null, now(), id);
}

/** Job failed: re-queue if attempts remain. Returns the final status. */
export function failOrRetry(id: string, error: string): JobStatus {
  const j = getJob(id);
  if (!j) return "failed";
  const status: JobStatus = j.attempts < j.max_attempts ? "queued" : "failed";
  db().query("UPDATE jobs SET status = ?, last_error = ?, lease_until = NULL, pid = NULL, updated_at = ? WHERE id = ?").run(status, error, now(), id);
  return status;
}

/** On server start: running jobs with an expired lease → queued again (02 §3). */
export function requeueExpired(): number {
  return db().query("UPDATE jobs SET status = 'queued', pid = NULL, updated_at = ? WHERE status = 'running' AND (lease_until IS NULL OR lease_until < ?)").run(now(), now()).changes;
}

export function cancelJobsFor(key: string, value: string): Job[] {
  const rows = (db().query(`SELECT * FROM jobs WHERE status IN ('queued','running') AND json_extract(payload, '$.${key}') = ?`).all(value) as Record<string, unknown>[]).map(map);
  for (const r of rows) finishJob(r.id, "cancelled");
  return rows;
}

export const recentJobs = (limit = 50): Job[] => (db().query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[]).map(map);
