// Assembling context from the evidence board, not the transcript (05 §5). Two cache breakpoints in system.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { listEntities } from "../db/repo/entities.ts";
import { listEvidence, listHypotheses } from "../db/repo/evidence.ts";
import { listAttachments } from "../db/repo/attachments.ts";
import { recentStepSummaries } from "../db/repo/sessions.ts";
import { listMessages } from "../db/repo/threads.ts";
import { projectCodeSummary } from "../repo/graph.ts";
import { getProject } from "../db/repo/projects.ts";
import type { AccessProfile, Environment } from "../db/repo/environments.ts";
import type { Issue } from "../db/repo/issues.ts";
import type { TextBlock } from "../llm/types.ts";
import { wrapUntrusted } from "../ingest/extract.ts";
import type { AgentState, ToolDef } from "./types.ts";
import { STATES } from "./states.ts";

let promptCache: string | undefined;
export function investigatorPrompt(): string {
  return (promptCache ??= readFileSync(join(config().rootDir, "prompts", "agent-investigator.md"), "utf8"));
}

export function systemBlocks(env: Environment | null, profile: AccessProfile | null, tools: ToolDef[], projectId: string, repoIds: string[]): TextBlock[] {
  const caps = Object.entries(profile?.capabilities ?? {}).filter(([k, v]) => v && !k.startsWith("mcp:")).map(([k]) => k);
  const accessLines = [
    `Environment: ${env ? `${env.name} (${env.kind}, account ${env.account_id}, zone ${env.timezone ?? "-"})` : "not selected yet (attachment + code analysis only)"}`,
    `Access tier: ${profile?.tier ?? "none"}. Capabilities: ${caps.join(", ") || "-"}.`,
    profile?.mcp_tools?.length ? `MCP tools available: ${profile.mcp_tools.join(", ")}` : "",
    env?.kind === "production" ? "PRODUCTION: read-only. Every write action is blocked by the guard and logged." : "",
    `Tools available: ${tools.map((t) => t.name).join(", ")}.`,
  ].filter(Boolean);
  const project = getProject(projectId);
  return [
    { type: "text", text: `${investigatorPrompt()}\n\n## Access Profile\n${accessLines.join("\n")}`, cache_control: { type: "ephemeral" } },
    { type: "text", text: `## Project context\nProject: ${project?.name ?? "-"}${project?.client_name ? ` (client ${project.client_name})` : ""}\n${project?.notes ? `Conventions: ${project.notes}\n` : ""}Automation per record type (from the SDF repo):\n${projectCodeSummary(repoIds)}`, cache_control: { type: "ephemeral" } },
  ];
}

const clip = (s: string | null | undefined, n: number) => ((s ?? "").length > n ? `${(s ?? "").slice(0, n)}…` : (s ?? ""));

export function issueBoard(issue: Issue, opts: { sinceChat?: number } = {}): string {
  const ents = listEntities(issue.id).filter((e) => e.status !== "rejected");
  const ev = listEvidence(issue.id, { includeRejected: false });
  const hyps = listHypotheses(issue.id);
  const atts = listAttachments(issue.id);
  const steps = recentStepSummaries(issue.id, 10);
  const chat = listMessages(issue.id, "agent").filter((m) => m.role === "user").slice(-5);
  const parts = [
    `# Issue ${issue.key}: ${issue.title}`,
    `Priority ${issue.priority}. Status ${issue.status}. Evidence level E${issue.evidence_level}.`,
    wrapUntrusted("issue description", clip(issue.description, 4000)),
    issue.triage ? `## Triage\n${JSON.stringify(issue.triage)}` : "",
    `## Entities (${ents.length})\n${ents.map((e) => `- ${e.type}: ${e.normalized ?? e.value}${e.status === "confirmed" || e.status === "manual" ? " (confirmed by user)" : ""} [${e.source_locator ?? ""}]`).join("\n") || "-"}`,
    `## Attachments\n${atts.map((a) => `- ${a.id} ${a.filename} (${a.ingest_status}): ${clip(a.summary, 300)}`).join("\n") || "-"}`,
    `## Evidence board\n${ev.map((e) => `- #E${e.seq} id=${e.id} E${e.level} [${e.status}] ${e.kind}: ${e.title} — ${clip(e.body, 300)}${e.ref ? ` ref=${clip(JSON.stringify(e.ref), 200)}` : ""}`).join("\n") || "-"}`,
    `## Hypotheses\n${hyps.map((h) => `- id=${h.id} ${(h.confidence * 100).toFixed(0)}% [${h.status}] ${h.statement}`).join("\n") || "-"}`,
    steps.length ? `## Last steps\n${steps.map((s) => `- [${s.state}] ${s.title ?? ""}: ${clip(s.summary, 200)}`).join("\n")}` : "",
    chat.length ? `## Recent messages from the user\n${chat.filter((m) => !opts.sinceChat || m.created_at > opts.sinceChat).map((m) => `- ${clip(m.content, 800)}`).join("\n")}` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function stateInstruction(state: AgentState, extra?: string): string {
  const d = STATES[state];
  if (!d) return "";
  return `## Current state: ${state}\nGoal: ${d.goal}.\n${d.instructions}\nAllowed transitions: ${d.next.join(", ")}.${extra ? `\n\nAdditional instructions from the user (priority):\n${extra}` : ""}`;
}
