import type { JobHandler } from "../handlers.ts";
import { probeEnvironment } from "../../netsuite/probe.ts";
import { getEnvironment } from "../../db/repo/environments.ts";
import { emit } from "../../realtime/events.ts";

const handler: JobHandler = async (job) => {
  const envId = String(job.payload.environmentId);
  const p = await probeEnvironment(envId);
  const env = getEnvironment(envId);
  if (env) emit({ type: "env.updated", environmentId: envId, projectId: env.project_id });
  return { tier: p.tier };
};
export default handler;
