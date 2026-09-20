// REPORT_DRAFT: root cause summary for the user + issues.root_cause (05 §3).
import { s } from "../lib/schema.ts";
import { type Result, ok } from "../lib/result.ts";
import { callStructured } from "../llm/client.ts";
import { maxTokensFor, modelFor } from "../llm/models.ts";
import { updateIssue, getIssue, type Issue } from "../db/repo/issues.ts";
import { issueBoard } from "./context.ts";

export const DraftSchema = s.object({
  one_line: s.string({ max: 300 }),
  root_cause_md: s.string({ max: 6000 }),
  limitations: s.array(s.string({ max: 400 }), { max: 6 }),
  recommended_next: s.array(s.string({ max: 300 }), { max: 6 }),
});
export type Draft = { one_line: string; root_cause_md: string; limitations: string[]; recommended_next: string[] };

export async function draftRootCause(issue: Issue, ctx: { sessionId: string; stepId: string }, model = modelFor("agent_main")): Promise<Result<Draft>> {
  const r = await callStructured(
    {
      model,
      max_tokens: maxTokensFor("report_writer"),
      ...(model.includes("haiku") ? {} : { thinking: { type: "disabled" as const } }),
      system: `You summarize NetSuite investigation results for a developer. Use only facts from the evidence board. Clearly distinguish: proven (cite #E), suspected, and unknown. No em dashes. English.`,
      messages: [{ role: "user", content: `${issueBoard(issue)}\n\nWrite: one_line (a one-sentence finding claim), root_cause_md (cause + mechanism + #E references, concise markdown), limitations (missing access / things not yet verified), recommended_next (next steps: capture, fix, ask the client).` }],
      tool: { name: "record_root_cause", description: "Record the root cause summary.", input_schema: DraftSchema.json() },
    },
    { issueId: issue.id, sessionId: ctx.sessionId, stepId: ctx.stepId, purpose: "report" },
    (v) => DraftSchema.parse(v),
  );
  if (!r.ok) return r;
  const d = r.value as Draft;
  const fresh = getIssue(issue.id)!;
  updateIssue(issue.id, { root_cause: `${d.one_line}\n\n${d.root_cause_md}${d.limitations.length ? `\n\n**Limitations**\n${d.limitations.map((l) => `- ${l}`).join("\n")}` : ""}`, status: fresh.evidence_level >= 4 ? "root_caused" : "awaiting_user" });
  return ok(d);
}
