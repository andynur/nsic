import type { AccessProfile, Environment, Tier } from "../db/repo/environments.ts";
import type { Issue } from "../db/repo/issues.ts";
import type { AgentSession, ToolRisk } from "../db/repo/sessions.ts";
import type { Result } from "../lib/result.ts";

export const AGENT_STATES = ["TRIAGE", "INVESTIGATE", "HYPOTHESIZE", "REPRODUCE", "ROOT_CAUSE", "REPORT_DRAFT", "AWAIT_USER", "CAPTURE", "FIX", "VALIDATE", "AWAIT_DEPLOY_APPROVAL", "DEPLOY_SANDBOX", "VERIFY", "DONE", "BLOCKED", "BUDGET_EXCEEDED"] as const;
export type AgentState = (typeof AGENT_STATES)[number];
export type EnvKind = Environment["kind"];

/** Side-effect scope: 'nsic' = NSIC DB/filesystem only (allowed in production), 'workspace' = local repo/SDF, 'netsuite' = NetSuite account. */
export type ToolScope = "nsic" | "workspace" | "netsuite";

export type ToolCtx = {
  issue: Issue;
  session: AgentSession;
  env: Environment | null;
  profile: AccessProfile | null;
  tier: Tier;
  state: AgentState;
  stepId: string;
  toolCallId: string;
  repoIds: string[];
  signal: AbortSignal;
};

export type ToolOutput = { content: string; data?: unknown; control?: { type: "checkpoint"; question: string; options?: string[] } | { type: "transition"; next: AgentState; summary: string } | { type: "escalate"; reason: string } };

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: Exclude<ToolRisk, "blocked">;
  scope: ToolScope;
  /** Required capabilities (all must be present). 'repo' = an indexed repo exists. */
  requires: string[];
  /** Tiers allowed to use the tool (empty = all). */
  tiers?: Tier[];
  allowedEnvKinds: EnvKind[] | "any";
  states: AgentState[] | "any";
  needsApproval?: boolean;
  parse: (input: unknown) => Result<Record<string, unknown>, unknown>;
  run: (input: Record<string, unknown>, ctx: ToolCtx) => Promise<Result<ToolOutput>>;
};
