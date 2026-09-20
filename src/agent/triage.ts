// TRIAGE (05 §3): Haiku, one structured call + similar issues from memory.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { s } from "../lib/schema.ts";
import { type Result, ok } from "../lib/result.ts";
import { callStructured } from "../llm/client.ts";
import { maxTokensFor, modelFor } from "../llm/models.ts";
import { findSimilar } from "../db/repo/memory.ts";
import { updateIssue, type Issue, type Triage } from "../db/repo/issues.ts";
import { issueBoard } from "./context.ts";

export const TriageSchema = s.object({
  category: s.enum(["bug", "config", "data", "governance", "integration", "permission", "performance", "enhancement", "unknown"] as const),
  severity: s.enum(["low", "medium", "high", "critical"] as const),
  module_area: s.string({ max: 40 }),
  suspected_record_types: s.array(s.string({ max: 60 }), { max: 10 }),
  plan: s.array(s.string({ max: 400 }), { min: 1, max: 7 }),
  missing_info: s.array(s.string({ max: 300 }), { max: 8 }),
});

export async function runTriage(issue: Issue, ctx: { sessionId: string; stepId: string }): Promise<Result<Triage>> {
  const similar = findSimilar(`${issue.title} ${issue.description}`, issue.id, 3);
  const prompt = readFileSync(join(config().rootDir, "prompts", "triage.md"), "utf8");
  const r = await callStructured(
    {
      model: modelFor("triage"),
      max_tokens: maxTokensFor("triage"),
      system: prompt,
      messages: [{ role: "user", content: `${issueBoard(issue)}\n\n## similar_issues (occurred before)\n${similar.length ? JSON.stringify(similar) : "-"}` }],
      tool: { name: "record_triage", description: "Record the triage result and investigation plan.", input_schema: TriageSchema.json() },
    },
    { issueId: issue.id, sessionId: ctx.sessionId, stepId: ctx.stepId, purpose: "triage" },
    (v) => TriageSchema.parse(v),
  );
  if (!r.ok) return r;
  const t = r.value as Triage;
  updateIssue(issue.id, { triage: t, category: t.category, severity: t.severity, module_area: t.module_area });
  return ok(t);
}
