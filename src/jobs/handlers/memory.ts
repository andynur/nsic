// Resolved-issue memory (05 §9): Haiku summarizes → issue_memory (FTS). Without an API key: a deterministic summary.
import type { JobHandler } from "../handlers.ts";
import { getIssue } from "../../db/repo/issues.ts";
import { listEntities } from "../../db/repo/entities.ts";
import { listEvidence } from "../../db/repo/evidence.ts";
import { upsertMemory } from "../../db/repo/memory.ts";
import { llmAvailable } from "../../llm/anthropic.ts";
import { s } from "../../lib/schema.ts";
import { callStructured } from "../../llm/client.ts";
import { maxTokensFor, modelFor } from "../../llm/models.ts";

const Mem = s.object({ symptoms: s.string({ max: 1500 }), root_cause: s.string({ max: 1500 }), fix_summary: s.string({ max: 1500 }) });

const handler: JobHandler = async (job) => {
  const issue = getIssue(String(job.payload.issueId));
  if (!issue) return;
  const ev = listEvidence(issue.id);
  const errorCodes = listEntities(issue.id).filter((e) => e.type === "error_code" && e.status !== "rejected").map((e) => e.normalized ?? e.value);
  const files = [...new Set(ev.map((e) => (e.ref as { file?: string } | null)?.file).filter((f): f is string => !!f))];
  let mem = { symptoms: `${issue.title}. ${issue.description.slice(0, 600)}`, root_cause: issue.root_cause ?? "", fix_summary: issue.resolution ?? "" };
  if (llmAvailable()) {
    const r = await callStructured(
      {
        model: modelFor("ingest"),
        max_tokens: maxTokensFor("ingest"),
        system: "Summarize a resolved NetSuite issue for similar-issue search memory, in English. Be concise and factual; name the record type, scripts, and error codes.",
        messages: [{ role: "user", content: JSON.stringify({ title: issue.title, description: issue.description.slice(0, 3000), root_cause: issue.root_cause, resolution: issue.resolution, evidence: ev.slice(0, 15).map((e) => ({ level: e.level, title: e.title, body: (e.body ?? "").slice(0, 300) })) }) }],
        tool: { name: "record_memory", description: "Record the issue memory.", input_schema: Mem.json() },
      },
      { issueId: issue.id, purpose: "summarize" },
      (v) => Mem.parse(v),
    );
    if (r.ok) mem = r.value;
  }
  upsertMemory({ issue_id: issue.id, project_id: issue.project_id, symptoms: mem.symptoms, root_cause: mem.root_cause, fix_summary: mem.fix_summary, files: JSON.stringify(files), error_codes: JSON.stringify(errorCodes) });
  return { ok: true };
};
export default handler;
