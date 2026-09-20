// Report narrative by the LLM (prompts/report-writer.md). Without an API key: a deterministic narrative from the ReportModel.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { llmAvailable } from "../llm/anthropic.ts";
import { s } from "../lib/schema.ts";
import { callStructured } from "../llm/client.ts";
import { maxTokensFor, modelFor } from "../llm/models.ts";
import type { ReportModel } from "./model.ts";

const Narr = s.object({
  title_claim: s.string({ max: 200 }),
  one_line: s.string({ max: 400 }),
  cause_intro: s.string({ max: 2000 }),
  evidence_intro: s.string({ max: 600 }),
  steps_intro: s.string({ max: 600 }),
  fix_intro: s.string({ max: 1500 }),
  caveats: s.array(s.string({ max: 400 }), { max: 8 }),
});

export async function writeNarrative(issueId: string, m: ReportModel): Promise<ReportModel> {
  if (!llmAvailable()) return m;
  const prompt = readFileSync(join(config().rootDir, "prompts", "report-writer.md"), "utf8");
  const slim = { ...m, usage: undefined, artifacts: undefined, timeline: m.timeline.slice(-30), evidence: m.evidence.map((e) => ({ ...e, body: e.body.slice(0, 600) })) };
  const model = modelFor("report_writer");
  const r = await callStructured(
    {
      model,
      max_tokens: maxTokensFor("report_writer"),
      ...(model.includes("haiku") ? {} : { thinking: { type: "disabled" as const } }),
      system: prompt,
      messages: [{ role: "user", content: `Audience: ${m.meta.audience}. English. No em dashes.\n\nReportModel:\n${JSON.stringify(slim)}` }],
      tool: { name: "record_report_text", description: "Record the report narrative.", input_schema: Narr.json() },
    },
    { issueId, purpose: "report" },
    (v) => Narr.parse(v),
  );
  if (!r.ok) return m;
  const n = r.value;
  return {
    ...m,
    answer: { ...m.answer, oneLine: n.one_line },
    narrative: { titleClaim: n.title_claim, causeIntro: n.cause_intro, evidenceIntro: n.evidence_intro, stepsIntro: n.steps_intro, fixIntro: n.fix_intro },
    caveats: [...new Set([...m.caveats, ...n.caveats])],
  };
}

export const EDITABLE_KEYS = ["titleClaim", "oneLine", "causeIntro", "evidenceIntro", "stepsIntro", "fixIntro"] as const;

/** Apply the text the user edited in the preview. */
export function applyOverrides(m: ReportModel, o: Record<string, string> | null): ReportModel {
  if (!o) return m;
  const n = { ...m.narrative };
  for (const k of Object.keys(n) as (keyof typeof n)[]) if (typeof o[k] === "string") n[k] = o[k]!;
  return { ...m, narrative: n, answer: { ...m.answer, ...(typeof o.oneLine === "string" ? { oneLine: o.oneLine } : {}) } };
}
