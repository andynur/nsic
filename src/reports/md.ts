// Compact Markdown export for Jira/Slack/email (12 §1).
import { levelLabel, type ReportModel } from "./model.ts";

export function renderMarkdown(m: ReportModel): string {
  const lines = [
    `# ${m.meta.issueKey}: ${m.narrative.titleClaim}`,
    "",
    `${m.answer.oneLine}`,
    "",
    `Status: **${m.answer.status}** · Evidence: **${levelLabel(m.answer.evidenceLevel)}**${m.meta.environment ? ` · Environment: ${m.meta.environment} (${m.meta.envKind})` : ""}`,
    "",
  ];
  if (m.answer.rootCause) lines.push("## Cause", "", m.answer.rootCause, "");
  if (m.evidence.length) {
    lines.push("## Evidence", "", "| ID | Level | Evidence | Reference |", "|---|---|---|---|");
    for (const e of m.evidence) lines.push(`| #E${e.seq} | E${e.level} | ${e.title.replace(/\|/g, "\\|")} | ${e.ref.replace(/\|/g, "\\|")} |`);
    lines.push("");
  }
  if (m.steps.length) {
    lines.push("## Steps to reproduce", "");
    for (const s of m.steps) lines.push(`${s.index}. ${s.caption}${s.status !== "passed" ? ` (${s.status}${s.note ? `: ${s.note}` : ""})` : ""}`);
    lines.push("");
  }
  if (m.answer.fix) lines.push("## Fix", "", m.answer.fix, "");
  if (m.beforeAfter.length) {
    lines.push("## Before and after", "", "| Step | Before | After |", "|---|---|---|");
    for (const r of m.beforeAfter) lines.push(`| ${r.step} | ${r.before} | ${r.after} |`);
    lines.push("");
  }
  if (m.qa.length) {
    lines.push("## Questions and answers", "");
    for (const q of m.qa) lines.push(`**${q.question}**`, "", q.answer, "");
  }
  if (m.caveats.length) lines.push("## Limitations", "", ...m.caveats.map((c) => `- ${c}`), "");
  if (m.usage) lines.push(`_AI usage: ${m.usage.total.tokens.toLocaleString("en-US")} tokens, USD ${m.usage.total.cost.toFixed(4)}_`, "");
  return lines.join("\n");
}
