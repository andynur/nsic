import type { JobHandler } from "../handlers.ts";
import { indexRepo } from "../../repo/indexer.ts";
import { getRepo } from "../../db/repo/code.ts";
import { clone, pull } from "../../repo/git.ts";
import { dataPath } from "../../lib/fs.ts";
import { existsSync } from "node:fs";

const handler: JobHandler = async (job) => {
  const repo = getRepo(String(job.payload.repoId));
  if (!repo) throw new Error("repo not found");
  if (repo.source === "git_url") {
    const dest = dataPath("repos", repo.id);
    const r = existsSync(dest) ? await pull(dest) : await clone(repo.location, dest);
    if (!r.ok) throw new Error(r.error.message);
  }
  const stats = await indexRepo(repo.id);
  return stats as unknown as Record<string, unknown>;
};
export default handler;
