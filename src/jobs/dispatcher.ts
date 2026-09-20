// Job dispatcher in the server (02 §3): take queued jobs as slots allow, spawn one worker per job.
import type { Subprocess } from "bun";
import { claimJob, failOrRetry, getJob, queuedJobs, requeueExpired, runningJobs, setJobPid, finishJob, type Job, type JobType } from "../db/repo/jobs.ts";
import { log } from "../lib/log.ts";
import type { IpcMessage } from "../realtime/events.ts";
import { LEASE_MS, runJob } from "./run-job.ts";
import { config } from "../config.ts";
import { join } from "node:path";

type Slots = Partial<Record<JobType, number>>;
const DEFAULT_SLOTS: Slots = { agent_session: 2, ingest: 2, index_repo: 1, probe_env: 2, browser_run: 1, record_video: 1, build_report: 1, sdf_deploy_sandbox: 1, poll_logs: 1, memory: 1 };
/** Browser jobs share one slot per environment (08 §2 mutex). */
const BROWSER_TYPES = new Set<JobType>(["browser_run", "record_video"]);

export type DispatcherOpts = {
  inProcess?: boolean; // test / debug: run jobs in the server process
  onIpc?: (m: IpcMessage) => void;
  slots?: Slots;
};

export class Dispatcher {
  private procs = new Map<string, Subprocess | AbortController>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(private readonly opts: DispatcherOpts = {}) {}

  start() {
    const n = requeueExpired();
    if (n) log.info("requeued expired jobs", { count: n });
    this.timer = setInterval(() => void this.tick(), 500);
  }

  stop() {
    clearInterval(this.timer);
    for (const [, p] of this.procs) {
      if (p instanceof AbortController) p.abort();
      else p.kill();
    }
  }

  /** Called after enqueue so we don't wait for the interval. */
  poke() {
    queueMicrotask(() => void this.tick());
  }

  cancel(jobId: string) {
    const p = this.procs.get(jobId);
    finishJob(jobId, "cancelled");
    if (!p) return;
    if (p instanceof AbortController) p.abort();
    else p.kill();
    this.procs.delete(jobId);
  }

  private busyEnvs(running: Job[]): Set<string> {
    return new Set(running.filter((j) => BROWSER_TYPES.has(j.type)).map((j) => String(j.payload.environmentId ?? "")));
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const running = runningJobs();
      const counts = new Map<JobType, number>();
      for (const j of running) counts.set(j.type, (counts.get(j.type) ?? 0) + 1);
      const busyEnvs = this.busyEnvs(running);
      const slots = { ...DEFAULT_SLOTS, ...this.opts.slots };
      for (const job of queuedJobs(50)) {
        const used = counts.get(job.type) ?? 0;
        if (used >= (slots[job.type] ?? 1)) continue;
        if (BROWSER_TYPES.has(job.type)) {
          const env = String(job.payload.environmentId ?? "");
          if (busyEnvs.has(env)) continue;
          busyEnvs.add(env);
        }
        if (!claimJob(job.id, LEASE_MS)) continue;
        counts.set(job.type, used + 1);
        this.launch(job);
      }
    } catch (e) {
      log.error("dispatcher tick failed", { error: String(e) });
    } finally {
      this.ticking = false;
    }
  }

  private launch(job: Job) {
    if (this.opts.inProcess) {
      const ac = new AbortController();
      this.procs.set(job.id, ac);
      void runJob(job.id, ac.signal).finally(() => {
        this.procs.delete(job.id);
        this.poke();
      });
      return;
    }
    const proc = Bun.spawn(["bun", "--no-orphans", join(config().rootDir, "src/worker.ts"), job.id], {
      cwd: config().rootDir,
      env: { ...process.env },
      stdout: "inherit",
      stderr: "inherit",
      ipc: (m) => this.opts.onIpc?.(m as IpcMessage),
      onExit: (_p, code) => {
        this.procs.delete(job.id);
        const j = getJob(job.id);
        if (j?.status === "running") {
          const st = failOrRetry(job.id, `worker exited with code ${code}`);
          log.warn("worker exited while job running", { jobId: job.id, code, next: st });
        }
        this.poke();
      },
    });
    setJobPid(job.id, proc.pid);
    this.procs.set(job.id, proc);
  }
}

let current: Dispatcher | undefined;
export const setDispatcher = (d: Dispatcher) => {
  current = d;
};
export const dispatcher = (): Dispatcher | undefined => current;
