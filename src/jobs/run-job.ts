// Run one job (used by worker.ts and in-process mode).
import { finishJob, failOrRetry, getJob, heartbeat } from "../db/repo/jobs.ts";
import { emit } from "../realtime/events.ts";
import { errorMessage } from "../lib/result.ts";
import { log } from "../lib/log.ts";
import { handlerFor } from "./handlers.ts";

export const LEASE_MS = 60_000;

export async function runJob(jobId: string, signal: AbortSignal = new AbortController().signal): Promise<"done" | "failed" | "queued" | "cancelled"> {
  const job = getJob(jobId);
  if (!job) return "failed";
  if (job.status === "cancelled") return "cancelled";
  const hb = setInterval(() => heartbeat(jobId, LEASE_MS), 15_000);
  const issueId = typeof job.payload.issueId === "string" ? job.payload.issueId : undefined;
  try {
    const handler = await handlerFor(job.type);
    const result = await handler(job, signal);
    if (getJob(jobId)?.status === "cancelled") return "cancelled";
    finishJob(jobId, "done");
    emit({ type: "job.done", jobId, jobType: job.type, ...(issueId && { issueId }), ...(result && { result }) });
    return "done";
  } catch (e) {
    const msg = errorMessage(e);
    log.error("job failed", { jobId, type: job.type, error: msg, stack: e instanceof Error ? e.stack : undefined });
    if (getJob(jobId)?.status === "cancelled") return "cancelled";
    const st = failOrRetry(jobId, msg);
    if (st === "failed") emit({ type: "job.failed", jobId, error: msg, ...(issueId && { issueId }) });
    return st === "queued" ? "queued" : "failed";
  } finally {
    clearInterval(hb);
  }
}
