// Worker entry: `bun --no-orphans src/worker.ts <jobId>` (02 §2). Events are sent to the server over IPC.
import { runJob } from "./jobs/run-job.ts";
import { db } from "./db/db.ts";
import { log } from "./lib/log.ts";

const jobId = process.argv[2];
if (!jobId) {
  console.error("usage: bun src/worker.ts <jobId>");
  process.exit(2);
}
db();
const ac = new AbortController();
process.on("SIGTERM", () => ac.abort());
process.on("unhandledRejection", (e) => log.error("worker unhandledRejection", { jobId, error: String(e) }));
const st = await runJob(jobId, ac.signal);
process.exit(st === "failed" ? 1 : 0);
