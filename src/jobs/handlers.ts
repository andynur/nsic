// Job handler registry. Imported by the worker (or in-process during tests).
import type { Job, JobType } from "../db/repo/jobs.ts";

export type JobHandler = (job: Job, signal: AbortSignal) => Promise<Record<string, unknown> | void>;

const registry = new Map<JobType, () => Promise<JobHandler>>([
  ["ingest", async () => (await import("./handlers/ingest.ts")).default],
  ["index_repo", async () => (await import("./handlers/index-repo.ts")).default],
  ["probe_env", async () => (await import("./handlers/probe-env.ts")).default],
  ["agent_session", async () => (await import("./handlers/agent-session.ts")).default],
  ["browser_run", async () => (await import("./handlers/browser-run.ts")).default],
  ["record_video", async () => (await import("./handlers/browser-run.ts")).default],
  ["build_report", async () => (await import("./handlers/build-report.ts")).default],
  ["sdf_deploy_sandbox", async () => (await import("./handlers/sdf-deploy.ts")).default],
  ["poll_logs", async () => (await import("./handlers/poll-logs.ts")).default],
  ["memory", async () => (await import("./handlers/memory.ts")).default],
]);

export async function handlerFor(type: JobType): Promise<JobHandler> {
  const f = registry.get(type);
  if (!f) throw new Error(`no handler for job ${type}`);
  return f();
}
