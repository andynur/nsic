// Tool registry + registry-layer guard (05 §4, 06 §6 layer 3).
// CHANGES TO THIS FILE MUST BE ACCOMPANIED BY A TEST IN tests/guard/ (AGENTS.md rule 6).
import type { AccessProfile, Environment, Tier } from "../../db/repo/environments.ts";
import type { AgentState, ToolDef } from "../types.ts";

const ALL_KINDS = ["sandbox", "production", "release_preview", "dev"] as const;

export type Availability = { available: boolean; reason?: string };

/** Whether the tool may be registered for this env + profile (without looking at state). */
export function toolAvailability(t: ToolDef, env: Pick<Environment, "kind"> | null, profile: Pick<AccessProfile, "capabilities" | "tier"> | null, hasRepo: boolean): Availability {
  const kind = env?.kind ?? "sandbox";
  const caps = profile?.capabilities ?? {};
  const tier: Tier = profile?.tier ?? "none";
  // Hard rule 1: in production only read tools, or internal NSIC bookkeeping.
  if (kind === "production" && !(t.risk === "read" || (t.risk === "local_write" && t.scope === "nsic"))) return { available: false, reason: "production: read tools only" };
  if (t.risk === "remote_write_sandbox" && kind !== "sandbox") return { available: false, reason: "sandbox only" };
  if (t.allowedEnvKinds !== "any" && !t.allowedEnvKinds.includes(kind)) return { available: false, reason: `not for env ${kind}` };
  if (t.tiers && t.tiers.length && !t.tiers.includes(tier)) return { available: false, reason: `not available at tier ${tier}` };
  for (const r of t.requires) {
    if (r === "repo" ? !hasRepo : !caps[r]) return { available: false, reason: `requires ${r}` };
  }
  return { available: true };
}

export function availableTools(all: ToolDef[], env: Pick<Environment, "kind"> | null, profile: Pick<AccessProfile, "capabilities" | "tier"> | null, hasRepo: boolean): ToolDef[] {
  return all.filter((t) => toolAvailability(t, env, profile, hasRepo).available);
}

export function allowedInState(t: ToolDef, state: AgentState): boolean {
  return t.states === "any" || t.states.includes(state);
}

/** Tool definitions for the Messages API, deterministic order (stable cache prefix). */
export function toApiTools(tools: ToolDef[]) {
  return [...tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
}

export { ALL_KINDS };
