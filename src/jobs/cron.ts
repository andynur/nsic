// In-process schedule (02 §1, 04 §5, 07 §8, 17 A3): token refresh, weekly probe, daily backup, cleanup, log polling.
import { readdirSync, rmSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db/db.ts";
import { dataPath } from "../lib/fs.ts";
import { log } from "../lib/log.ts";
import { listAllEnvironments } from "../db/repo/environments.ts";
import { getCredentialRow } from "../db/repo/credentials.ts";
import { enqueueJob } from "./enqueue.ts";
import { getMcpAccessToken } from "../netsuite/oauth-pkce.ts";

export function backupDb(keep = 14): string {
  const dir = dataPath("backup");
  mkdirSync(dir, { recursive: true });
  const d = new Date();
  const name = `nsic-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.db`;
  const target = join(dir, name);
  rmSync(target, { force: true });
  db().run(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const files = readdirSync(dir).filter((f) => /^nsic-\d{8}\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) rmSync(join(dir, f), { force: true });
  return target;
}

export function cleanupLogs(days = 90) {
  const dir = dataPath("logs");
  let removed = 0;
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (Date.now() - statSync(p).mtimeMs > days * 86400_000) {
        rmSync(p, { force: true });
        removed++;
      }
    }
  } catch {
    /* folder doesn't exist yet */
  }
  return removed;
}

const safe = (name: string, fn: () => unknown | Promise<unknown>) => async () => {
  try {
    await fn();
  } catch (e) {
    log.error("cron failed", { name, error: String(e) });
  }
};

export function startCron(): Bun.CronJob[] {
  return [
    Bun.cron("*/10 * * * *", safe("refresh-mcp", async () => {
      for (const env of listAllEnvironments()) if (getCredentialRow(env.id, "mcp_oauth")) await getMcpAccessToken(env.id);
    })),
    Bun.cron("0 3 * * 0", safe("probe-weekly", () => {
      for (const env of listAllEnvironments()) enqueueJob("probe_env", { environmentId: env.id }, { priority: 2, maxAttempts: 1 });
    })),
    Bun.cron("30 2 * * *", safe("backup", () => log.info("backup", { file: backupDb() }))),
    Bun.cron("0 4 * * *", safe("cleanup", () => log.info("cleanup logs", { removed: cleanupLogs() }))),
    Bun.cron("*/30 * * * *", safe("poll-logs", () => {
      for (const env of listAllEnvironments()) if (env.monitor_enabled) enqueueJob("poll_logs", { environmentId: env.id }, { priority: 3, maxAttempts: 1 });
    })),
  ];
}
