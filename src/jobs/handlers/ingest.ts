import type { JobHandler } from "../handlers.ts";
import { ingestIssue } from "../../ingest/pipeline.ts";
import { getIssue, updateIssue } from "../../db/repo/issues.ts";
import { getProject } from "../../db/repo/projects.ts";
import { emit } from "../../realtime/events.ts";
import { startAgentSession } from "../../agent/start.ts";

const handler: JobHandler = async (job) => {
  const issueId = String(job.payload.issueId);
  const issue = getIssue(issueId);
  if (!issue) return;
  if (issue.status === "draft") {
    updateIssue(issueId, { status: "ingesting" });
    emit({ type: "issue.updated", issueId, patch: { status: "ingesting" } });
  }
  const r = await ingestIssue(issueId);
  const after = getIssue(issueId)!;
  const autoRun = job.payload.autoRun ?? getProject(after.project_id)?.auto_run_agent ?? true;
  if (after.status === "ingesting") {
    updateIssue(issueId, { status: autoRun ? "investigating" : "draft" });
    emit({ type: "issue.updated", issueId, patch: { status: autoRun ? "investigating" : "draft", evidence_level: after.evidence_level } });
  }
  if (autoRun) startAgentSession(issueId, "auto");
  return { processed: r.processed };
};
export default handler;
