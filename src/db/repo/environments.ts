import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { bool, buildPatch, j, pj } from "./_util.ts";

export type EnvKind = "sandbox" | "production" | "release_preview" | "dev";
export type Tier = "A" | "B" | "C" | "P" | "none";

export type Environment = {
  id: string;
  project_id: string;
  name: string;
  kind: EnvKind;
  account_id: string;
  timezone: string | null;
  ui_base_url: string | null;
  mcp_url: string | null;
  automation_consent_at: number | null;
  monitor_enabled: boolean;
  last_polled_at: number | null;
  created_at: number;
};

export type Capabilities = Record<string, boolean>;
export type AccessProfile = {
  id: string;
  environment_id: string;
  tier: Tier;
  capabilities: Capabilities;
  mcp_tools: string[] | null;
  role_name: string | null;
  probed_at: number;
  probe_log: string | null;
};

const mapEnv = (r: Record<string, unknown>): Environment => ({ ...(r as unknown as Environment), monitor_enabled: bool(r.monitor_enabled) });

export const listEnvironments = (projectId: string): Environment[] =>
  (db().query("SELECT * FROM environments WHERE project_id = ? ORDER BY created_at").all(projectId) as Record<string, unknown>[]).map(mapEnv);

export const listAllEnvironments = (): Environment[] =>
  (db().query("SELECT * FROM environments ORDER BY created_at").all() as Record<string, unknown>[]).map(mapEnv);

export function getEnvironment(id: string): Environment | null {
  const r = db().query("SELECT * FROM environments WHERE id = ?").get(id) as Record<string, unknown> | null;
  return r ? mapEnv(r) : null;
}

/** Default MCP URL (06 §2): SuiteApp MCP Standard Tools only. */
export const defaultMcpUrl = (accountId: string) =>
  `https://${accountId.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools`;

export const defaultUiBaseUrl = (accountId: string) => `https://${accountId.toLowerCase().replace(/_/g, "-")}.app.netsuite.com`;

export function createEnvironment(input: {
  project_id: string;
  name: string;
  kind: EnvKind;
  account_id: string;
  timezone?: string | null;
  ui_base_url?: string | null;
  mcp_url?: string | null;
}): Environment {
  const id = newId();
  db()
    .query(
      "INSERT INTO environments (id, project_id, name, kind, account_id, timezone, ui_base_url, mcp_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      input.project_id,
      input.name,
      input.kind,
      input.account_id,
      input.timezone ?? null,
      input.ui_base_url ?? defaultUiBaseUrl(input.account_id),
      input.mcp_url ?? defaultMcpUrl(input.account_id),
      now(),
    );
  return getEnvironment(id)!;
}

export function updateEnvironment(id: string, patch: Record<string, unknown>): Environment | null {
  const { sets, vals } = buildPatch(patch, ["name", "kind", "account_id", "timezone", "ui_base_url", "mcp_url", "automation_consent_at", "monitor_enabled", "last_polled_at"]);
  if (sets.length) db().query(`UPDATE environments SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return getEnvironment(id);
}

export const deleteEnvironment = (id: string) => db().query("DELETE FROM environments WHERE id = ?").run(id);

const mapProfile = (r: Record<string, unknown>): AccessProfile => ({
  ...(r as unknown as AccessProfile),
  capabilities: pj<Capabilities>(r.capabilities, {}),
  mcp_tools: pj<string[] | null>(r.mcp_tools, null),
});

export function latestAccessProfile(envId: string): AccessProfile | null {
  const r = db().query("SELECT * FROM access_profiles WHERE environment_id = ? ORDER BY probed_at DESC LIMIT 1").get(envId) as Record<string, unknown> | null;
  return r ? mapProfile(r) : null;
}

export const accessProfileHistory = (envId: string, limit = 20): AccessProfile[] =>
  (db().query("SELECT * FROM access_profiles WHERE environment_id = ? ORDER BY probed_at DESC LIMIT ?").all(envId, limit) as Record<string, unknown>[]).map(mapProfile);

export function insertAccessProfile(p: Omit<AccessProfile, "id" | "probed_at">): AccessProfile {
  const id = newId();
  db()
    .query("INSERT INTO access_profiles (id, environment_id, tier, capabilities, mcp_tools, role_name, probed_at, probe_log) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, p.environment_id, p.tier, JSON.stringify(p.capabilities), j(p.mcp_tools), p.role_name, now(), p.probe_log);
  return latestAccessProfile(p.environment_id)!;
}
