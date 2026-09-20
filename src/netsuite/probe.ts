// Capability probe (06 §4) → Access Profile + tier.
import { getEnvironment, insertAccessProfile, type AccessProfile, type Capabilities, type Environment, type Tier } from "../db/repo/environments.ts";
import { getCredentialRow } from "../db/repo/credentials.ts";
import { listRepos } from "../db/repo/code.ts";
import { McpClient, isWriteTool } from "./mcp-client.ts";
import { runSuiteQL, pingMetadata, QUERIES } from "./suiteql.ts";
import { suitecloudAvailable } from "./sdf.ts";

export function computeTier(env: Pick<Environment, "kind">, c: Capabilities): Tier {
  const hasRest = !!c.suiteql || !!c.rest_record;
  if (env.kind === "production") return c.mcp || hasRest || c.browser_session ? "P" : "none";
  if (c.mcp && hasRest && c.sdf) return "A";
  if (hasRest && c.sdf) return "B";
  if (c.mcp && hasRest) return "B";
  if (c.browser_session || c.mcp) return "C";
  return "none";
}

/** How to enable a missing capability (shown in the UI). */
export const CAPABILITY_HINTS: Record<string, string> = {
  mcp: "Install the SuiteApp MCP Standard Tools, create a non-admin MCP role, then Connect in wizard step 4.",
  suiteql: "Enable REST Web Services, create a Client Credentials integration record, upload the certificate (step 5).",
  rest_record: "Same as SuiteQL; the role needs the relevant record permission (View).",
  exec_logs: "The role needs access to the Script Execution Log, or install a read-only RESTlet helper (07 §4).",
  sdf: "Install SuiteCloud CLI + Java, then run account:setup in step 6.",
  browser_session: "Run Login Assist (step 7) and log in with the correct role.",
  repo: "Connect the SDF repo on the project page, then run indexing.",
};

export type ProbeDeps = {
  probeMcp: (envId: string) => Promise<{ ok: boolean; tools: string[]; writeTools: string[]; log: string }>;
  probeSuiteql: (envId: string) => Promise<{ ok: boolean; log: string }>;
  probeRecord: (envId: string) => Promise<{ ok: boolean; log: string }>;
  probeLogs: (envId: string) => Promise<{ ok: boolean; log: string }>;
  probeSdf: (envId: string) => Promise<{ ok: boolean; log: string }>;
  probeBrowser: (envId: string) => Promise<{ ok: boolean; log: string }>;
};

export const defaultProbeDeps: ProbeDeps = {
  async probeMcp(envId) {
    if (!getCredentialRow(envId, "mcp_oauth")) return { ok: false, tools: [], writeTools: [], log: "mcp: no OAuth token yet" };
    const c = await McpClient.forEnvironment(envId);
    if (!c.ok) return { ok: false, tools: [], writeTools: [], log: `mcp: ${c.error.message}` };
    const t = await c.value.listTools();
    if (!t.ok) return { ok: false, tools: [], writeTools: [], log: `mcp: ${t.error.message}` };
    return { ok: true, tools: t.value.map((x) => x.name), writeTools: t.value.filter(isWriteTool).map((x) => x.name), log: `mcp: ${t.value.length} tool` };
  },
  async probeSuiteql(envId) {
    if (!getCredentialRow(envId, "rest_m2m")) return { ok: false, log: "suiteql: no M2M credentials yet" };
    const r = await runSuiteQL(envId, QUERIES.probe, { limit: 1 });
    return { ok: r.ok, log: r.ok ? "suiteql: ok" : `suiteql: ${r.error.message}` };
  },
  async probeRecord(envId) {
    if (!getCredentialRow(envId, "rest_m2m")) return { ok: false, log: "rest_record: no M2M credentials yet" };
    const r = await pingMetadata(envId);
    return { ok: r.ok, log: r.ok ? "rest_record: ok" : `rest_record: ${r.error.message}` };
  },
  async probeLogs(envId) {
    if (!getCredentialRow(envId, "rest_m2m")) return { ok: false, log: "exec_logs: requires SuiteQL" };
    const r = await runSuiteQL(envId, QUERIES.probeLogs, { limit: 1 });
    return { ok: r.ok, log: r.ok ? "exec_logs: ok" : `exec_logs: ${r.error.message}` };
  },
  async probeSdf(envId) {
    if (!getCredentialRow(envId, "sdf_auth_id")) return { ok: false, log: "sdf: authId not saved yet" };
    const ok = await suitecloudAvailable();
    return { ok, log: ok ? "sdf: CLI available" : "sdf: suitecloud CLI not found" };
  },
  async probeBrowser(envId) {
    const { checkBrowserSession } = await import("../browser/session.ts");
    return checkBrowserSession(envId);
  },
};

export async function probeEnvironment(envId: string, deps: ProbeDeps = defaultProbeDeps): Promise<AccessProfile> {
  const env = getEnvironment(envId);
  if (!env) throw new Error("environment not found");
  const [mcp, sql, rec, logs, sdf, browser] = await Promise.all([deps.probeMcp(envId), deps.probeSuiteql(envId), deps.probeRecord(envId), deps.probeLogs(envId), deps.probeSdf(envId), deps.probeBrowser(envId)]);
  const caps: Capabilities = {
    mcp: mcp.ok,
    suiteql: sql.ok,
    rest_record: rec.ok,
    exec_logs: logs.ok,
    sdf: sdf.ok,
    browser_session: browser.ok,
    repo: listRepos(env.project_id).some((r) => r.last_indexed_at !== null),
  };
  for (const t of mcp.tools) caps[`mcp:${t}`] = true;
  if (env.kind === "production" && mcp.writeTools.length) caps.prod_write_exposed = true;
  const tier = computeTier(env, caps);
  const probeLog = [mcp.log, sql.log, rec.log, logs.log, sdf.log, browser.log, ...(caps.prod_write_exposed ? [`WARNING: MCP write tools exposed in production: ${mcp.writeTools.join(", ")}. The agent is forced read-only; change the role to View.`] : [])].join("\n");
  return insertAccessProfile({ environment_id: envId, tier, capabilities: caps, mcp_tools: mcp.tools, role_name: null, probe_log: probeLog });
}
