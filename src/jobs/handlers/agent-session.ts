import type { JobHandler } from "../handlers.ts";
import { runSession } from "../../agent/orchestrator.ts";
import { getSession, updateSession } from "../../db/repo/sessions.ts";

const handler: JobHandler = async (job, signal) => {
  const sessionId = String(job.payload.sessionId);
  const s = getSession(sessionId);
  if (!s) return;
  if (s.status !== "running") updateSession(sessionId, { status: "running" });
  await runSession(sessionId, signal, typeof job.payload.directive === "string" ? job.payload.directive : undefined);
  return { state: getSession(sessionId)?.state };
};
export default handler;
