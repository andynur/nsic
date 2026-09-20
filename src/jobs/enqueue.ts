import { enqueue as dbEnqueue, type JobType } from "../db/repo/jobs.ts";
import { dispatcher } from "./dispatcher.ts";

export function enqueueJob(type: JobType, payload: Record<string, unknown>, opts: { priority?: number; maxAttempts?: number } = {}) {
  const j = dbEnqueue(type, payload, opts);
  dispatcher()?.poke();
  return j;
}
