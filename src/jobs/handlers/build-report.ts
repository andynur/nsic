import type { JobHandler } from "../handlers.ts";
import { buildReport } from "../../reports/builder.ts";
import { addMessage } from "../../db/repo/threads.ts";
import { getReportDraft } from "../../db/repo/reports.ts";
import { emit } from "../../realtime/events.ts";

const handler: JobHandler = async (job) => {
  const draftId = String(job.payload.draftId);
  const r = await buildReport(draftId);
  const d = getReportDraft(draftId);
  if (!r.ok) {
    if (d) emit({ type: "job.failed", jobId: job.id, error: r.error.message, issueId: d.issue_id });
    throw new Error(r.error.message);
  }
  if (d) {
    const m = addMessage(d.issue_id, "agent", { role: "system_event", content: `Report ready: ${r.value.map((a) => a.kind.replace("report_", "").toUpperCase()).join(", ")}` });
    emit({ type: "message.added", issueId: d.issue_id, thread: "agent", message: m as unknown as Record<string, unknown> });
  }
  return { artifacts: r.value.map((a) => a.id) };
};
export default handler;
