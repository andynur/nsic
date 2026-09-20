// Consultant assistant (11 §2): no tools, only a safe projection of the issue. Output is filtered before display.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { llmAvailable, llmStatus } from "../llm/anthropic.ts";
import { s } from "../lib/schema.ts";
import { type Result, ok, appErr } from "../lib/result.ts";
import { findSecrets } from "../lib/redact-secrets.ts";
import { getIssue } from "../db/repo/issues.ts";
import { listEvidence, listHypotheses } from "../db/repo/evidence.ts";
import { addMessage, getMessage, listMessages, updateMessage, type Message } from "../db/repo/threads.ts";
import { callStructured } from "../llm/client.ts";
import { maxTokensFor, modelFor } from "../llm/models.ts";
import { emit } from "../realtime/events.ts";

export type DraftParams = { question: string; language: "id" | "en" | "auto"; tone: "formal" | "casual"; length: "short" | "paragraph" | "bullets"; audience: "functional" | "client" | "technical"; eta?: string; modifier?: "shorter" | "more_formal" | "translate"; previousDraftId?: string };

export const DraftOutput = s.object({ answer: s.string({ min: 1, max: 4000 }), cited_evidence: s.array(s.string(), { max: 20 }), confidence_note: s.string({ max: 400 }).nullable() });

/** Safe projection (11 §2): no credentials, local paths, raw logs, private evidence, cost. */
export function issueBrief(issueId: string, eta?: string): string {
  const i = getIssue(issueId)!;
  const ev = listEvidence(issueId, { includeRejected: false, publicOnly: true });
  const hyps = listHypotheses(issueId).filter((h) => h.status !== "refuted");
  const stripPaths = (t: string) => t.replace(/(?:\/[\w.-]+){2,}\.\w+(:\d+)?/g, (m) => m.split("/").pop() ?? m).replace(/\bnsic\/[\w.-]+/g, "(fix branch)");
  const lines = [
    `Title: ${i.title}`,
    `Status: ${i.status}. Evidence level: E${i.evidence_level} (E1 reported, E2 observed in data, E3 reproduced, E4 cause found, E5 fix verified).`,
    i.root_cause ? `Root cause (developer draft): ${stripPaths(i.root_cause).slice(0, 2000)}` : "Root cause: not yet determined.",
    `Evidence:\n${ev.map((e) => `- #E${e.seq} E${e.level} ${e.title}: ${stripPaths((e.body ?? "").slice(0, 300))}`).join("\n") || "-"}`,
    `Open hypotheses:\n${hyps.map((h) => `- ${(h.confidence * 100).toFixed(0)}% ${h.statement}`).join("\n") || "-"}`,
    `ETA from the developer: ${eta?.trim() || "not yet set"}`,
  ];
  return `<issue_brief>\n${lines.join("\n")}\n</issue_brief>`;
}

/** Output filter (11 §2): secrets, local paths, internal email. */
export function outputViolations(text: string): string[] {
  const v = findSecrets(text);
  if (/(?:\/Users\/|\/home\/|[A-Z]:\\)[^\s]+/.test(text)) v.push("local path");
  if (/\bnsic\/[A-Za-z0-9._-]+/.test(text)) v.push("branch name");
  if (/\b(?:src\/FileCabinet|SuiteScripts\/)[^\s]*\.js\b/.test(text)) v.push("repo file path");
  if (/\$\s?\d+(?:\.\d+)?\s*(?:USD)?\b.*(token|biaya|cost)/i.test(text)) v.push("AI cost");
  return v;
}

const LENGTH = { short: "1-2 sentences", paragraph: "1 paragraph (max 5 sentences)", bullets: "bullet points (max 5 points)" } as const;
const AUD = { functional: "functional consultant", client: "end-user client", technical: "technical team" } as const;

export async function draftConsultantAnswer(issueId: string, p: DraftParams): Promise<Result<Message>> {
  if (!getIssue(issueId)) return appErr("not_found", "issue not found");
  if (!llmAvailable()) return appErr("llm_no_key", llmStatus().detail);
  const q = addMessage(issueId, "consultant", { role: "user", content: p.question, meta: { language: p.language, tone: p.tone, length: p.length, audience: p.audience, ...(p.modifier && { modifier: p.modifier }) } });
  emit({ type: "message.added", issueId, thread: "consultant", message: q as unknown as Record<string, unknown> });
  const prev = p.previousDraftId ? getMessage(p.previousDraftId) : null;
  const system = readFileSync(join(config().rootDir, "prompts", "consultant-assistant.md"), "utf8")
    .replace("{{language}}", p.language === "auto" ? "follow the language of the question" : p.language === "id" ? "Indonesian" : "English")
    .replace("{{tone}}", p.tone === "formal" ? "formal" : "casual-professional")
    .replace("{{length}}", LENGTH[p.length])
    .replace("{{audience}}", AUD[p.audience]);
  const mod = p.modifier === "shorter" ? "Produce a shorter version of the previous draft." : p.modifier === "more_formal" ? "Produce a more formal version of the previous draft." : p.modifier === "translate" ? `Translate the previous draft into ${p.language === "en" ? "English" : "Indonesian"}.` : "";
  const model = p.length === "paragraph" && p.audience === "technical" ? modelFor("agent_main") : modelFor("consultant");
  const r = await callStructured(
    {
      model,
      max_tokens: maxTokensFor("consultant"),
      ...(model.includes("haiku") ? {} : { thinking: { type: "disabled" as const } }),
      system,
      messages: [{ role: "user", content: `${issueBrief(issueId, p.eta)}\n\nConsultant question:\n<untrusted_content source="consultant message">\n${p.question}\n</untrusted_content>${prev ? `\n\nPrevious draft:\n${prev.content}\n\n${mod}` : ""}` }],
      tool: { name: "record_draft", description: "Record the answer draft.", input_schema: DraftOutput.json() },
    },
    { issueId, purpose: "consultant" },
    (v) => DraftOutput.parse(v),
  );
  if (!r.ok) return r;
  const violations = outputViolations(r.value.answer);
  const a = addMessage(issueId, "consultant", {
    role: "assistant",
    content: r.value.answer,
    meta: { question: p.question, cited: r.value.cited_evidence, confidence_note: r.value.confidence_note, held: violations.length > 0, violations, params: p },
  });
  emit({ type: "consultant.done", issueId, messageId: a.id, text: a.content });
  emit({ type: "message.added", issueId, thread: "consultant", message: a as unknown as Record<string, unknown> });
  return ok(a);
}

export function markFaq(messageId: string, faq: boolean) {
  const m = getMessage(messageId);
  if (!m) return null;
  return updateMessage(messageId, { meta: { ...(m.meta ?? {}), faq } });
}

export const consultantHistory = (issueId: string) => listMessages(issueId, "consultant");
