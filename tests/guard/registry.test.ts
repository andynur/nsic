import { describe, expect, test } from "bun:test";
import { ALL_TOOLS, toolByName } from "../../src/agent/tools/defs.ts";
import { availableTools, toolAvailability } from "../../src/agent/tools/registry.ts";
import { guardSuiteQL } from "../../src/netsuite/suiteql.ts";
import { isWriteTool } from "../../src/netsuite/mcp-client.ts";

const full = { tier: "A" as const, capabilities: { mcp: true, suiteql: true, rest_record: true, exec_logs: true, sdf: true, browser_session: true, repo: true } };

describe("tool registry guard", () => {
  test("production: only read or NSIC bookkeeping tools", () => {
    const tools = availableTools(ALL_TOOLS, { kind: "production" }, { ...full, tier: "P" }, true);
    for (const t of tools) expect(t.risk === "read" || (t.risk === "local_write" && t.scope === "nsic")).toBe(true);
    for (const n of ["git_branch_and_patch", "sdf_validate", "sdf_deploy_sandbox", "run_tests"]) expect(tools.find((t) => t.name === n)).toBeUndefined();
  });
  test("deploy only sandbox and tier A/B", () => {
    const d = toolByName("sdf_deploy_sandbox")!;
    expect(toolAvailability(d, { kind: "sandbox" }, full, true).available).toBe(true);
    expect(toolAvailability(d, { kind: "release_preview" }, full, true).available).toBe(false);
    expect(toolAvailability(d, { kind: "sandbox" }, { ...full, tier: "C" }, true).available).toBe(false);
    expect(d.needsApproval).toBe(true);
  });
  test("tool without capability is not offered", () => {
    const names = availableTools(ALL_TOOLS, { kind: "sandbox" }, { tier: "none", capabilities: {} }, false).map((t) => t.name);
    expect(names).not.toContain("suiteql_query");
    expect(names).not.toContain("search_code");
    expect(names).toContain("add_evidence");
  });
  test("SuiteQL only allows a single SELECT/WITH statement", () => {
    expect(guardSuiteQL("SELECT id FROM customer").ok).toBe(true);
    expect(guardSuiteQL("WITH x AS (SELECT 1 FROM dual) SELECT * FROM x;").ok).toBe(true);
    expect(guardSuiteQL("SELECT 'delete' AS t FROM dual").ok).toBe(true);
    expect(guardSuiteQL("DELETE FROM customer").ok).toBe(false);
    expect(guardSuiteQL("SELECT 1 FROM dual; DROP TABLE x").ok).toBe(false);
  });
  test("detects MCP write tool", () => {
    expect(isWriteTool({ name: "ns_createRecord" })).toBe(true);
    expect(isWriteTool({ name: "ns_getRecord" })).toBe(false);
    expect(isWriteTool({ name: "ns_runSavedSearch", annotations: { destructiveHint: true } })).toBe(true);
  });
});
