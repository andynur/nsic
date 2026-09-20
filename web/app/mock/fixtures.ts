// Sample data for static UI mode (bun run ui). Data shape = the API contract (docs/13), no backend.
import type { Artifact, AuditEntry, Entity, EnvView, Evidence, Hypothesis, Issue, IssueDetail, IssueRow, Message, Project, ProjectDetail, Repo, ReproScript, Run, Session, Step, Totals } from "../types.ts";
import { nsShot } from "./shots.ts";

const NOW = Date.now();
export const ago = (min: number) => NOW - Math.round(min * 60_000);
const T0: Totals = { calls: 0, input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, cost_usd: 0 };
const tot = (calls: number, input: number, output: number, cw: number, cr: number, cost: number): Totals => ({ calls, input_tokens: input, output_tokens: output, cache_write_tokens: cw, cache_read_tokens: cr, cost_usd: cost });

// ───────── Project, environment, repo ─────────
export const projects: Project[] = [
  { id: "p-acme", name: "ACME Manufacturing", client_name: "PT Acme Indonesia", key_prefix: "ACME", auto_run_agent: true, default_budget_usd: 3, notes: "Two-level vendor bill approval. Subsidiary ID & SG.", created_at: ago(60 * 24 * 40), archived_at: null },
  { id: "p-nus", name: "Nusantara Retail", client_name: "Nusantara Retail Group", key_prefix: "NUS", auto_run_agent: true, default_budget_usd: 2, notes: null, created_at: ago(60 * 24 * 12), archived_at: null },
];

const caps = (c: Record<string, boolean>) => c;
export const envs: EnvView[] = [
  {
    id: "e-acme-sb1", project_id: "p-acme", name: "SB1", kind: "sandbox", account_id: "1234567_SB1", timezone: "Asia/Jakarta", ui_base_url: "https://1234567-sb1.app.netsuite.com", mcp_url: "https://1234567-sb1.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools", automation_consent_at: ago(60 * 24 * 39), monitor_enabled: false, created_at: ago(60 * 24 * 39),
    profile: { id: "ap1", tier: "A", capabilities: caps({ mcp: true, suiteql: true, rest_record: true, exec_logs: true, sdf: true, browser_session: true, repo: true }), mcp_tools: ["ns_getRecord", "ns_runCustomSuiteQL", "ns_listSavedSearches", "ns_runSavedSearch", "ns_getRecordTypeMetadata", "ns_createRecord", "ns_updateRecord"], probed_at: ago(60 * 5), probe_log: "mcp: 7 tools\nsuiteql: ok\nrest_record: ok\nexec_logs: ok\nsdf: CLI available\nbrowser: session active" },
    credentials: [{ kind: "mcp_oauth", updated_at: ago(60 * 5), expires_at: ago(-40) }, { kind: "rest_m2m", updated_at: ago(60 * 24 * 30), expires_at: null }, { kind: "sdf_auth_id", updated_at: ago(60 * 24 * 30), expires_at: null }, { kind: "browser_session", updated_at: ago(60 * 20), expires_at: null }],
    capabilityTable: [],
  },
  {
    id: "e-acme-prod", project_id: "p-acme", name: "Production", kind: "production", account_id: "1234567", timezone: "Asia/Jakarta", ui_base_url: "https://1234567.app.netsuite.com", mcp_url: "https://1234567.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools", automation_consent_at: ago(60 * 24 * 39), monitor_enabled: true, created_at: ago(60 * 24 * 39),
    profile: { id: "ap2", tier: "P", capabilities: caps({ mcp: true, suiteql: true, rest_record: true, exec_logs: true, sdf: false, browser_session: true, repo: true }), mcp_tools: ["ns_getRecord", "ns_runCustomSuiteQL", "ns_listSavedSearches", "ns_runSavedSearch"], probed_at: ago(60 * 24 * 2), probe_log: "mcp: 4 tools\nsuiteql: ok\nrest_record: ok\nexec_logs: ok\nsdf: authId not saved yet\nbrowser: session active" },
    credentials: [{ kind: "mcp_oauth", updated_at: ago(60 * 24 * 2), expires_at: ago(-30) }, { kind: "rest_m2m", updated_at: ago(60 * 24 * 30), expires_at: null }, { kind: "browser_session", updated_at: ago(60 * 24 * 2), expires_at: null }],
    capabilityTable: [],
  },
  {
    id: "e-nus-sb", project_id: "p-nus", name: "Sandbox", kind: "sandbox", account_id: "7654321_SB2", timezone: "Asia/Jakarta", ui_base_url: "https://7654321-sb2.app.netsuite.com", mcp_url: null, automation_consent_at: ago(60 * 24 * 11), monitor_enabled: false, created_at: ago(60 * 24 * 11),
    profile: { id: "ap3", tier: "C", capabilities: caps({ mcp: false, suiteql: false, rest_record: false, exec_logs: false, sdf: false, browser_session: true, repo: false }), mcp_tools: [], probed_at: ago(60 * 24), probe_log: "mcp: no OAuth token yet\nsuiteql: no M2M credentials yet\nrest_record: no M2M credentials yet\nexec_logs: requires SuiteQL\nsdf: authId not saved yet\nbrowser: session active" },
    credentials: [{ kind: "browser_session", updated_at: ago(60 * 24), expires_at: null }],
    capabilityTable: [],
  },
];
const HINTS: Record<string, string> = {
  mcp: "Install the SuiteApp MCP Standard Tools, create a non-admin MCP role, then Connect in wizard step 4.",
  suiteql: "Enable REST Web Services, create a Client Credentials integration record, upload the certificate (step 5).",
  rest_record: "Same as SuiteQL; the role needs the relevant record permission (View).",
  exec_logs: "The role needs access to the Script Execution Log, or install a read-only RESTlet helper.",
  sdf: "Install SuiteCloud CLI + Java, then run account:setup in step 6.",
  browser_session: "Run Login Assist (step 7) and log in with the correct role.",
  repo: "Connect the SDF repo on the project page, then run indexing.",
};
for (const e of envs) e.capabilityTable = Object.entries(HINTS).map(([name, hint]) => ({ name, available: !!e.profile?.capabilities[name], hint }));

export const repos: (Repo & { project_id: string })[] = [
  { id: "r-acme", project_id: "p-acme", source: "local_path", location: "/Users/dev/clients/acme/acme-sdf", sdf_root: "src", project_type: "ACCOUNTCUSTOMIZATION", last_indexed_at: ago(60 * 3), last_indexed_commit: "9f3c2a1", stats: { files: 148, objects: 96, edges: 412 } },
];

// ───────── Issues ─────────
const issueBase = (o: Partial<Issue> & Pick<Issue, "id" | "key" | "title" | "project_id">): Issue => ({
  environment_id: null, description: "", reporter: null, priority: "normal", status: "draft", category: null, severity: null, module_area: null, evidence_level: 0, root_cause: null, resolution: null, budget_usd: null, triage: null, questions_for_client: null, created_at: ago(60), updated_at: ago(30), ...o,
});

export const issues: Issue[] = [
  issueBase({
    id: "i-42", key: "ACME-42", project_id: "p-acme", environment_id: "e-acme-sb1", title: "Vendor bill VB-1042 fails to approve: Record has been changed", reporter: "Rina (Finance)", priority: "high", status: "root_caused",
    category: "bug", severity: "high", module_area: "P2P", evidence_level: 4, created_at: ago(95), updated_at: ago(6), budget_usd: null,
    description: "From an email from Rina (Finance), Sep 12, 2026:\n\nHi, since yesterday we haven't been able to approve vendor bill VB-1042 and several other bills over 100 million. Every time we click Approve we get an error \"Record has been changed\". We've tried retrying and logging out, same result. The role used is A/P Clerk. Please check, this is holding up supplier payments this week.",
    root_cause: "Approval of VB-1042 fails because two user event scripts save the same vendor bill again in afterSubmit.\n\n`customscript_acme_ue_vb_approval` (ue_vb_approval.js:13) and `customscript_acme_ue_vb_sync_ap` (ue_vb_sync_ap.js:12) both perform `record.load` then `save()` on the bill being approved. The second save is rejected by NetSuite with RCRD_HAS_BEEN_CHANGED (#E4, #E5). The symptom was reproduced in SB1 (#E6).\n\n**Limitations**\n- Not yet verified in production; only read read-only.",
    triage: { plan: ["get_record_automation on vendorbill to map active UE scripts/workflows", "get_execution_logs Sep 11-12 for RCRD_HAS_BEEN_CHANGED errors", "suiteql_query system notes for VB-1042 around the approval time", "read_code the afterSubmit of each UE script that saves the record", "reproduce the approval in SB1 with the A/P Clerk role"], missing_info: ["Does this happen for all subsidiaries?"], suspected_record_types: ["vendorbill"] },
    questions_for_client: ["Does the error occur on all vendor bills or only those over 100 million?", "Were there any script or approval workflow changes last week?"],
  }),
  issueBase({ id: "i-43", key: "ACME-43", project_id: "p-acme", environment_id: "e-acme-sb1", title: "Map/Reduce invoice reminder stops midway: SSS_USAGE_LIMIT_EXCEEDED", reporter: "Budi (AR)", priority: "normal", status: "investigating", category: "governance", severity: "medium", module_area: "O2C", evidence_level: 2, created_at: ago(40), updated_at: ago(1) }),
  issueBase({ id: "i-41", key: "ACME-41", project_id: "p-acme", environment_id: "e-acme-sb1", title: "Sales order discount doesn't save when customer is changed", reporter: "Sari (Sales Ops)", priority: "normal", status: "resolved", category: "bug", severity: "medium", module_area: "O2C", evidence_level: 5, created_at: ago(60 * 24 * 6), updated_at: ago(60 * 24 * 2) }),
  issueBase({ id: "i-n7", key: "NUS-7", project_id: "p-nus", environment_id: "e-nus-sb", title: "Tax Invoice Number field missing from the invoice form", reporter: "Consultant: Dewi", priority: "high", status: "awaiting_user", category: "config", severity: "medium", module_area: "O2C", evidence_level: 2, created_at: ago(60 * 5), updated_at: ago(60 * 2) }),
  issueBase({ id: "i-n8", key: "NUS-8", project_id: "p-nus", environment_id: "e-nus-sb", title: "Stock-by-location report differs from the saved search", reporter: "Consultant: Dewi", priority: "normal", status: "ingesting", evidence_level: 0, created_at: ago(2), updated_at: ago(1) }),
  issueBase({ id: "i-44", key: "ACME-44", project_id: "p-acme", environment_id: "e-acme-sb1", title: "AP sync integration sends duplicate bills to the bank system", reporter: "Rina (Finance)", priority: "urgent", status: "budget_exceeded", category: "integration", severity: "high", module_area: "integration", evidence_level: 2, budget_usd: 3, created_at: ago(60 * 26), updated_at: ago(60 * 20) }),
  issueBase({ id: "i-45", key: "ACME-45", project_id: "p-acme", environment_id: "e-acme-prod", title: "[Monitor] customscript_acme_mr_invoice_reminder: SSS_USAGE_LIMIT_EXCEEDED", priority: "high", status: "awaiting_user", category: "governance", severity: "high", module_area: "O2C", evidence_level: 3, created_at: ago(60 * 9), updated_at: ago(60 * 8) }),
  issueBase({
    id: "i-46", key: "ACME-46", project_id: "p-acme", environment_id: "e-acme-sb1", title: "Invoice PDF prints the ID tax number on SG subsidiary invoices", reporter: "Budi (AR)", priority: "high", status: "fixing",
    category: "bug", severity: "medium", module_area: "O2C", evidence_level: 4, created_at: ago(60 * 3), updated_at: ago(4),
    root_cause: "The invoice template reads `custbody_acme_tax_reg_no` from the Indonesian subsidiary record, hardcoded as id 2 in `ue_inv_tax_fields.js:21`, instead of the invoice's own subsidiary.",
  }),
  issueBase({ id: "i-40", key: "ACME-40", project_id: "p-acme", environment_id: "e-acme-prod", title: "A/P Clerk role can't see the Approval History tab", reporter: "Rina (Finance)", priority: "low", status: "closed", category: "permission", severity: "low", module_area: "P2P", evidence_level: 4, created_at: ago(60 * 24 * 14), updated_at: ago(60 * 24 * 10) }),
];

export const issueCost: Record<string, number> = { "i-46": 0.736, "i-42": 1.284, "i-43": 0.412, "i-41": 2.106, "i-n7": 0.318, "i-n8": 0.004, "i-44": 3.012, "i-45": 0.088, "i-40": 0.941 };
export const sessionState: Record<string, string | null> = { "i-43": "INVESTIGATE", "i-n8": null };

export function issueRows(): IssueRow[] {
  return issues.map((i) => {
    const env = envs.find((e) => e.id === i.environment_id);
    return { ...i, project_name: projects.find((p) => p.id === i.project_id)?.name ?? "", env_name: env?.name ?? null, env_kind: env?.kind ?? null, cost_usd: issueCost[i.id] ?? null, session_state: sessionState[i.id] ?? null };
  }).sort((a, b) => b.updated_at - a.updated_at);
}

// ───────── Detail ACME-42 ─────────
const ents: Entity[] = [
  { id: "en1", type: "transaction_no", value: "VB-1042", normalized: "VB-1042", source_locator: "email body line 3", confidence: 0.95, status: "confirmed" },
  { id: "en2", type: "error_message", value: "Record has been changed", normalized: "Record has been changed", source_locator: "screenshot-approve.png", confidence: 0.9, status: "confirmed" },
  { id: "en3", type: "error_code", value: "RCRD_HAS_BEEN_CHANGED", normalized: "RCRD_HAS_BEEN_CHANGED", source_locator: "inferred", confidence: 0.6, status: "auto" },
  { id: "en4", type: "role", value: "A/P Clerk", normalized: "A/P Clerk", source_locator: "email body line 5", confidence: 0.7, status: "auto" },
  { id: "en5", type: "timestamp", value: "2026-09-12", normalized: "2026-09-12", source_locator: "header Date", confidence: 0.8, status: "auto" },
  { id: "en6", type: "internal_id", value: "88213", normalized: "88213", source_locator: "vendbill.nl?id=88213", confidence: 0.9, status: "auto" },
];
const atts = [
  { id: "a1", filename: "RE_ Approval VB-1042 failed.eml", mime: "message/rfc822", size_bytes: 48210, ingest_status: "done", summary: "Email from Rina (Finance): VB-1042 and several bills over 100 million have failed to approve since Sep 12 with the error \"Record has been changed\".", source: "upload", parent_id: null, meta: null },
  { id: "a2", filename: "screenshot-approve.png", mime: "image/png", size_bytes: 312004, ingest_status: "done", summary: "Screenshot of the VB-1042 form showing the \"Record has been changed\" error banner after clicking Approve.", source: "email_child", parent_id: "a1", meta: null },
  { id: "a3", filename: "list-of-failed-bills.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 18220, ingest_status: "done", summary: "7 vendor bills failing approval, all valued over IDR 100 million, subsidiary ACME Indonesia.", source: "upload", parent_id: null, meta: null },
  { id: "a4", filename: "notes.msg", mime: "application/vnd.ms-outlook", size_bytes: 90112, ingest_status: "unsupported", summary: "The .msg (Outlook) file isn't supported yet. Save the email as .eml and re-upload.", source: "upload", parent_id: null, meta: null },
];
const ev: Evidence[] = [
  { id: "ev4", seq: 4, level: 4, kind: "code_ref", title: "ue_vb_approval.js afterSubmit loads and re-saves the bill", body: "afterSubmit on APPROVE calls record.load(VENDOR_BILL) then bill.save() to stamp custbody_acme_approved_by. This save changes the record's version.", ref: { file: "src/FileCabinet/SuiteScripts/acme/ue_vb_approval.js", line: 13, scriptid: "customscript_acme_ue_vb_approval" }, status: "confirmed", private: false, created_at: ago(20) },
  { id: "ev5", seq: 5, level: 4, kind: "code_ref", title: "ue_vb_sync_ap.js afterSubmit also saves the same bill", body: "When approvalstatus = 2, the script loads the bill and calls save() to set custbody_acme_ap_synced. Because it runs after the approval UE, the second save is rejected: RCRD_HAS_BEEN_CHANGED.", ref: { file: "src/FileCabinet/SuiteScripts/acme/ue_vb_sync_ap.js", line: 12, scriptid: "customscript_acme_ue_vb_sync_ap" }, status: "proposed", private: false, created_at: ago(18) },
  { id: "ev6", seq: 6, level: 3, kind: "repro_run", title: "Symptom appears when replaying the reproduction in SB1", body: "Clicking Approve on VB-1042 (clone) produces the \"Record has been changed\" banner.", ref: { run_id: "run-1" }, status: "confirmed", private: false, created_at: ago(26) },
  { id: "ev2", seq: 2, level: 2, kind: "execution_log", title: "14 RCRD_HAS_BEEN_CHANGED errors from customscript_acme_ue_vb_sync_ap", body: "All errors occurred Sep 11-12 on the afterSubmit event, right after the new ue_vb_approval version was deployed (Sep 10).", ref: { query: "SELECT sel.date, sel.title, s.scriptid FROM scriptexecutionlog sel ... WHERE sel.type IN ('ERROR')" }, status: "confirmed", private: false, created_at: ago(70) },
  { id: "ev3", seq: 3, level: 2, kind: "system_note", title: "System notes for VB-1042: two changes in the same second", body: "Sep 12 09:14:03 approvalstatus → Approved (A/P Clerk), 09:14:03 custbody_acme_approved_by set by script.", ref: { query: "SELECT sn.date, sn.field ... FROM systemnote sn WHERE sn.recordid = 88213" }, status: "proposed", private: true, created_at: ago(62) },
  { id: "ev1", seq: 1, level: 1, kind: "client_report", title: "Structured client report", body: "VB-1042 and 6 other bills over 100 million have failed to approve since Sep 12 with \"Record has been changed\".", ref: null, status: "confirmed", private: false, created_at: ago(92) },
];
const hyps: Hypothesis[] = [
  { id: "h1", statement: "Two afterSubmit user events (approval stamp + AP sync) load and save the same bill, so the second save is rejected.", confidence: 0.9, status: "accepted" },
  { id: "h2", statement: "The ACME Vendor Bill Approval workflow changes approvalstatus at the same time as the script.", confidence: 0.2, status: "refuted" },
  { id: "h3", statement: "The 100 million threshold triggers a CFO validation in beforeSubmit that fails.", confidence: 0.1, status: "refuted" },
];
export const approval46 = {
  toolCallId: "tc-46-deploy",
  branch: "nsic/ACME-46",
  files: ["src/FileCabinet/SuiteScripts/acme/ue_inv_tax_fields.js"],
  objects: ["customscript_acme_ue_inv_tax_fields"],
  diff: "--- a/src/FileCabinet/SuiteScripts/acme/ue_inv_tax_fields.js\n+++ b/src/FileCabinet/SuiteScripts/acme/ue_inv_tax_fields.js\n@@ -18,7 +18,8 @@ define(['N/record', 'N/search'], (record, search) => {\n   const beforeLoad = (context) => {\n     const inv = context.newRecord;\n-    const sub = record.load({ type: record.Type.SUBSIDIARY, id: 2 });\n+    const subId = inv.getValue({ fieldId: 'subsidiary' });\n+    const sub = record.load({ type: record.Type.SUBSIDIARY, id: subId });\n     inv.setValue({ fieldId: 'custbody_acme_tax_reg_no', value: sub.getValue('federalidnumber') });\n   };\n",
};
export const messages46: Message[] = [
  { id: "m46-1", role: "system_event", content: "Fix session started from the Fix action.", html: "", meta: null, created_at: ago(12) },
  { id: "m46-2", role: "assistant", content: "Validation passed. Approve deploy to sandbox?", html: "<p>Validation passed. Approve deploy to sandbox?</p>", meta: { checkpoint: true, options: ["Approve", "Reject"], state: "AWAIT_DEPLOY_APPROVAL", approval: approval46 }, created_at: ago(4) },
];

const sessions42: Session[] = [{ id: "s-42", trigger: "auto", state: "AWAIT_USER", status: "awaiting_user", model_main: "claude-sonnet-5", started_at: ago(90), ended_at: null, error: null }];

const u = (calls: number, i: number, o: number, cw: number, cr: number, c: number) => tot(calls, i, o, cw, cr, c);
const tc = (id: string, tool: string, input: unknown, out: string, ms: number, ok = true) => ({ id, tool, risk: "read", input, output_preview: out, ok, duration_ms: ms });
export const steps42: Step[] = [
  { id: "st1", seq: 1, state: "TRIAGE", kind: "llm", title: "Triage", summary: "bug · high · P2P. Plan: get_record_automation vendorbill → get_execution_logs Sep 11-12 → system notes VB-1042 → read_code afterSubmit → reproduce approval in SB1", status: "done", started_at: ago(89), ended_at: ago(88.8), usage: u(1, 3120, 412, 0, 0, 0.0052), toolCalls: [] },
  { id: "st2", seq: 2, state: "TRIAGE", kind: "transition", title: "TRIAGE → INVESTIGATE", summary: "", status: "done", started_at: ago(88.8), ended_at: ago(88.8), usage: null, toolCalls: [] },
  { id: "st3", seq: 3, state: "INVESTIGATE", kind: "llm", title: "investigating · round 1", summary: "Starting from automation on vendorbill, then checking the execution log in the reported time range.", status: "done", started_at: ago(88.7), ended_at: ago(88.5), usage: u(1, 1840, 386, 9420, 0, 0.0342), toolCalls: [] },
  { id: "st4", seq: 4, state: "INVESTIGATE", kind: "tool", title: "get_record_automation", summary: "3 automations: customscript_acme_ue_vb_approval (UE, RELEASED), customscript_acme_ue_vb_sync_ap (UE, RELEASED), customworkflow_acme_vb_approval (workflow)", status: "done", started_at: ago(88.5), ended_at: ago(88.5), usage: null, toolCalls: [tc("tc1", "get_record_automation", { record_type: "vendorbill" }, "{\n \"items\": [\n  { \"scriptid\": \"customscript_acme_ue_vb_approval\", \"objectType\": \"usereventscript\", \"file\": \"src/FileCabinet/SuiteScripts/acme/ue_vb_approval.js\", \"entryPoints\": [\"afterSubmit\"] },\n  { \"scriptid\": \"customscript_acme_ue_vb_sync_ap\", ... }\n ]\n}", 42)] },
  { id: "st5", seq: 5, state: "INVESTIGATE", kind: "tool", title: "get_execution_logs", summary: "14 log entries: RCRD_HAS_BEEN_CHANGED from customscript_acme_ue_vb_sync_ap, Sep 11-12", status: "done", started_at: ago(88.4), ended_at: ago(88.1), usage: null, toolCalls: [tc("tc2", "get_execution_logs", { script_id: null, from: "2026-09-11", to: "2026-09-12", level: "ERROR" }, "14 log entries\n[ { \"date\": \"12/9/2026 09:14\", \"type\": \"ERROR\", \"title\": \"RCRD_HAS_BEEN_CHANGED\", \"scriptid\": \"customscript_acme_ue_vb_sync_ap\" }, ... ]", 2140)] },
  { id: "st6", seq: 6, state: "INVESTIGATE", kind: "tool", title: "add_evidence", summary: "Evidence #E2 (E2) saved. Issue evidence level is now E2.", status: "done", started_at: ago(88.0), ended_at: ago(88.0), usage: null, toolCalls: [] },
  { id: "st7", seq: 7, state: "INVESTIGATE", kind: "tool", title: "suiteql_query", summary: "6 rows of system notes for VB-1042 at 12 Sep 09:14:03", status: "done", started_at: ago(87.6), ended_at: ago(87.2), usage: null, toolCalls: [tc("tc3", "suiteql_query", { query: "SELECT sn.date, BUILTIN.DF(sn.name) AS who, sn.field, sn.oldvalue, sn.newvalue FROM systemnote sn WHERE sn.recordid = 88213 ORDER BY sn.date DESC", limit: 50 }, "6 rows\n[ { \"date\": \"12/9/2026 09:14:03\", \"who\": \"Rina\", \"field\": \"approvalstatus\", ... } ]", 1260)] },
  { id: "st8", seq: 8, state: "INVESTIGATE", kind: "tool", title: "read_code", summary: "src/FileCabinet/SuiteScripts/acme/ue_vb_sync_ap.js (lines 1-29 of 29)", status: "done", started_at: ago(87.0), ended_at: ago(87.0), usage: null, toolCalls: [tc("tc4", "read_code", { path: "src/FileCabinet/SuiteScripts/acme/ue_vb_sync_ap.js" }, "    9    const status = context.newRecord.getValue({ fieldId: 'approvalstatus' });\n   10    if (String(status) !== '2') return;\n   11    const bill = record.load({ type: record.Type.VENDOR_BILL, id });\n   12    bill.setValue({ fieldId: 'custbody_acme_ap_synced', value: true });\n   13    bill.save({ ignoreMandatoryFields: true });", 8)] },
  { id: "st9", seq: 9, state: "INVESTIGATE", kind: "transition", title: "INVESTIGATE → HYPOTHESIZE", summary: "Two afterSubmit UEs load+save the same bill; logs and system notes are consistent.", status: "done", started_at: ago(86.5), ended_at: ago(86.5), usage: null, toolCalls: [] },
  { id: "st10", seq: 10, state: "HYPOTHESIZE", kind: "tool", title: "update_hypotheses", summary: "h1 70% [open] Two afterSubmit user events ...\nh2 20% [open] Approval workflow ...\nh3 10% [open] CFO validation ...", status: "done", started_at: ago(86), ended_at: ago(86), usage: null, toolCalls: [] },
  { id: "st11", seq: 11, state: "HYPOTHESIZE", kind: "transition", title: "HYPOTHESIZE → REPRODUCE", summary: "Strongest hypothesis at 70%; reproducing in SB1 adds evidence.", status: "done", started_at: ago(85.8), ended_at: ago(85.8), usage: null, toolCalls: [] },
  { id: "st12", seq: 12, state: "REPRODUCE", kind: "tool", title: "write_repro_script", summary: "Repro script v1 saved (6 steps).", status: "done", started_at: ago(85), ended_at: ago(85), usage: null, toolCalls: [] },
  { id: "st13", seq: 13, state: "REPRODUCE", kind: "tool", title: "run_repro", summary: "Run run-1 (reproduce) status failed.\n1. navigate passed\n2. wait passed\n3. assert passed\n4. click passed\n5. expectError passed errors=[\"RCRD_HAS_BEEN_CHANGED\"]", status: "done", started_at: ago(84), ended_at: ago(82.5), usage: null, toolCalls: [] },
  { id: "st14", seq: 14, state: "REPRODUCE", kind: "transition", title: "REPRODUCE → ROOT_CAUSE", summary: "Symptom appears when approving in SB1 (#E6).", status: "done", started_at: ago(82), ended_at: ago(82), usage: null, toolCalls: [] },
  { id: "st15", seq: 15, state: "ROOT_CAUSE", kind: "llm", title: "root cause · round 1", summary: "Cause: afterSubmit ordering. ue_vb_approval saves the bill first; ue_vb_sync_ap loads the stale version and its save is rejected.", status: "done", started_at: ago(22), ended_at: ago(21.5), usage: u(1, 2204, 918, 0, 21680, 0.0151), toolCalls: [] },
  { id: "st16", seq: 16, state: "ROOT_CAUSE", kind: "tool", title: "add_evidence", summary: "Evidence #E4 (E4) saved. Issue evidence level is now E4.", status: "done", started_at: ago(20), ended_at: ago(20), usage: null, toolCalls: [] },
  { id: "st17", seq: 17, state: "ROOT_CAUSE", kind: "transition", title: "ROOT_CAUSE → REPORT_DRAFT", summary: "Root cause pinpointed to two file:line locations with a mechanism.", status: "done", started_at: ago(17), ended_at: ago(17), usage: null, toolCalls: [] },
  { id: "st18", seq: 18, state: "REPORT_DRAFT", kind: "llm", title: "Root cause summary", summary: "Approval of VB-1042 fails because two user event scripts save the same vendor bill again in afterSubmit.", status: "done", started_at: ago(16), ended_at: ago(15.6), usage: u(1, 3380, 604, 0, 21680, 0.0171), toolCalls: [] },
  { id: "st19", seq: 19, state: "REPORT_DRAFT", kind: "transition", title: "REPORT_DRAFT → AWAIT_USER", summary: "Waiting for direction: final capture or fix.", status: "done", started_at: ago(15.5), ended_at: ago(15.5), usage: null, toolCalls: [] },
];

export const messages42: Message[] = [
  { id: "m1", role: "system_event", content: "Agent session started automatically after 4 attachments were processed.", html: "", meta: null, created_at: ago(90) },
  { id: "m2", role: "user", content: "Also check the approval workflow, maybe a workflow is setting the status at the same time.", html: "<p>Also check the approval workflow, maybe a workflow is setting the status at the same time.</p>", meta: null, created_at: ago(60) },
  { id: "m3", role: "system_event", content: "Direction noted; the agent will read it on the next round.", html: "", meta: null, created_at: ago(60) },
  { id: "m4", role: "system_event", content: "Browser reproduce run finished: failed. The symptom appeared at step 5.", html: "", meta: null, created_at: ago(82.5) },
  {
    id: "m5", role: "assistant", content: "",
    html: "<p><strong>Approval of VB-1042 fails because two user event scripts save the same vendor bill again in afterSubmit.</strong></p><p><code>customscript_acme_ue_vb_approval</code> (ue_vb_approval.js:13) loads and saves the bill to stamp the approver. After that, <code>customscript_acme_ue_vb_sync_ap</code> (ue_vb_sync_ap.js:12) loads the stale version and saves it again, so NetSuite rejects it with RCRD_HAS_BEEN_CHANGED (#E4, #E5). The approval workflow doesn't change the same field (h2 refuted).</p><p><strong>Next steps</strong></p><ul><li>Final capture for screenshot and video evidence.</li><li>Fix: replace <code>record.load + save</code> with <code>record.submitFields</code> in both scripts.</li><li>Confirm with the client whether there was a deploy change on Sep 10.</li></ul>",
    meta: { kind: "root_cause" }, created_at: ago(15.5),
  },
  { id: "m6", role: "assistant", content: "Root cause is at E4 and the symptom has been reproduced. Where should we go next?", html: "<p>Root cause is at E4 and the symptom has been reproduced. Where should we go next?</p>", meta: { checkpoint: true, options: ["Final capture", "Draft a fix in sandbox", "Ask the client first"] }, created_at: ago(15.4) },
];

export const consultant42: Message[] = [
  { id: "c1", role: "user", content: "Hey, any idea why VB-1042 can't be approved? The client is asking when it'll be fixed.", html: "", meta: { tone: "casual" }, created_at: ago(12) },
  {
    id: "c2", role: "assistant",
    content: "We found the cause: during approval, two automated scripts modify the same bill almost at the same time, so NetSuite rejects the save with \"Record has been changed\". I'll test the fix in sandbox first; once it passes verification, I'll share the release schedule to production.",
    html: "", meta: { question: "Hey, any idea why VB-1042 can't be approved? The client is asking when it'll be fixed.", cited: ["#E4", "#E5", "#E6"], confidence_note: "ETA not yet set by the developer.", held: false, violations: [], faq: true }, created_at: ago(11.9),
  },
];

const shot = (step: number, caption: string, h: "approve" | "status" | "error" | "none", error?: string) => ({ caption, src: nsShot({ title: "Vendor Bill VB-1042 (clone)", step, highlight: h, ...(error ? { error } : {}), status: step >= 5 ? "Pending Approval" : "Pending Approval" }) });
const shots1 = [
  shot(1, "Open Vendor Bill VB-1042 (clone in SB1)", "none"),
  shot(2, "Form finished loading", "none"),
  shot(3, "Status still Pending Approval", "status"),
  shot(4, "Click Approve as A/P Clerk", "approve"),
  shot(5, "Record has been changed error appears", "error", "Record has been changed. RCRD_HAS_BEEN_CHANGED"),
];
export const mockSrc: Record<string, string> = {};
export const artifacts42: Artifact[] = shots1.map((s, k) => {
  const id = `art-${k + 1}`;
  mockSrc[id] = s.src;
  return { id, run_id: "run-1", kind: "screenshot", step_index: k + 1, caption: s.caption, storage_path: `issues/i-42/screenshots/run-1/0${k + 1}.png`, mime: "image/png", size_bytes: 210_000, redacted: true, created_at: ago(83) };
});
artifacts42.push({ id: "art-rep", run_id: null, kind: "report_pdf", step_index: null, caption: "Report PDF (internal)", storage_path: "issues/i-42/reports/ACME-42-internal-202609181010.pdf", mime: "application/pdf", size_bytes: 412_000, redacted: false, created_at: ago(9) });

export const runs42: Run[] = [
  { id: "run-1", mode: "reproduce", status: "failed", started_at: ago(84), ended_at: ago(82.5), result: { steps: shots1.map((s, k) => ({ index: k + 1, id: `s${k + 1}`, action: ["navigate", "wait", "assert", "click", "expectError"][k]!, status: "passed", caption: s.caption, screenshotArtifactId: `art-${k + 1}` })), blocked: [] } },
];
export const repro42: ReproScript[] = [{ id: "rs-1", version: 1, author: "agent", created_at: ago(85), dsl: { version: 1, environment: "SB1", role_hint: "A/P Clerk", steps: [{ id: "s1", action: "navigate", url: "/app/accounting/transactions/vendbill.nl?id=88213", caption: "Open Vendor Bill VB-1042" }, { id: "s2", action: "wait", for: { selector: "#main_form" } }, { id: "s3", action: "assert", target: { field: "approvalstatus" }, expect: { textIncludes: "Pending Approval" } }, { id: "s4", action: "click", target: { text: "Approve", role: "button" }, sandboxOnly: true }, { id: "s5", action: "expectError", match: "RCRD_HAS_BEEN_CHANGED" }] } }];
export const blocked42: AuditEntry[] = [];

export function detailFor(id: string): IssueDetail {
  const i = issues.find((x) => x.id === id || x.key === id);
  if (!i) throw { code: "not_found", message: "issue not found", status: 404 };
  const env = envs.find((e) => e.id === i.environment_id) ?? null;
  const project = projects.find((p) => p.id === i.project_id)!;
  const is42 = i.id === "i-42";
  const cost = issueCost[i.id] ?? 0;
  const totals = is42 ? tot(9, 18420, 4210, 9420, 86720, cost) : cost ? tot(3, 5200, 900, 1200, 4000, cost) : T0;
  const generic = genericDetail(i);
  return {
    issue: i,
    rootCauseHtml: i.root_cause ? mdToHtml(i.root_cause) : null,
    project,
    environment: env ? { ...env, tier: env.profile?.tier ?? "none", capabilities: env.profile?.capabilities ?? {} } : null,
    entities: is42 ? ents : generic.entities,
    attachments: is42 ? atts : generic.attachments,
    evidence: is42 ? ev : generic.evidence,
    hypotheses: is42 ? hyps : generic.hypotheses,
    sessions: is42 ? sessions42 : generic.sessions,
    activeSession: is42 ? sessions42[0]! : generic.sessions.find((s) => ["running", "awaiting_user", "budget_exceeded"].includes(s.status)) ?? null,
    usage: { totals, byPurpose: [], budget: i.budget_usd ?? project.default_budget_usd, cacheHitRatio: totals.cache_read_tokens / Math.max(1, totals.input_tokens + totals.cache_read_tokens + totals.cache_write_tokens) },
    artifacts: is42 ? artifacts42 : [],
    runs: is42 ? runs42 : [],
    reproScripts: is42 ? repro42 : [],
    blocked: i.id === "i-45" ? [{ id: "b1", at: ago(60 * 8), action: "browser.blocked", detail: { reason: "the \"Save\" button is a write action", target: "btn_multibutton_submitter" } }] : blocked42,
  };
}

/** Issue status → [agent state, session status] for fixture issues without hand-written sessions. */
const SESSION_BY_STATUS: Record<string, [string, string]> = {
  investigating: ["INVESTIGATE", "running"], budget_exceeded: ["INVESTIGATE", "budget_exceeded"], awaiting_user: ["AWAIT_USER", "awaiting_user"],
  fixing: ["AWAIT_DEPLOY_APPROVAL", "awaiting_user"], verifying: ["VERIFY", "running"],
};

function genericDetail(i: Issue) {
  const status = i.status;
  const session: Session | null =
    status === "ingesting" ? null
    : { id: `s-${i.id}`, trigger: i.key.startsWith("ACME-45") ? "monitor" : i.id === "i-46" ? "fix" : "auto", state: SESSION_BY_STATUS[status]?.[0] ?? "DONE", status: SESSION_BY_STATUS[status]?.[1] ?? "done", model_main: "claude-sonnet-5", started_at: i.created_at + 60_000, ended_at: null, error: status === "budget_exceeded" ? "Issue budget insufficient ($0.0000 remaining)" : null };
  return {
    entities: i.id === "i-46" ? [{ id: `${i.id}-en1`, type: "script_id", value: "customscript_acme_ue_inv_tax_fields", normalized: null, source_locator: "description", confidence: 0.9, status: "confirmed" }] : i.evidence_level ? [{ id: `${i.id}-en1`, type: "error_code", value: i.title.match(/[A-Z_]{8,}/)?.[0] ?? "USER_ERROR", normalized: null, source_locator: "description", confidence: 0.8, status: "auto" }] : [],
    attachments: status === "ingesting" ? [{ id: `${i.id}-a1`, filename: "stock-by-location.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 52_000, ingest_status: "running", summary: null, source: "upload", parent_id: null, meta: null }, { id: `${i.id}-a2`, filename: "saved-search.png", mime: "image/png", size_bytes: 210_000, ingest_status: "pending", summary: null, source: "paste", parent_id: null, meta: null }] : [],
    evidence: i.evidence_level ? [{ id: `${i.id}-e1`, seq: 1, level: 1, kind: "client_report", title: "Structured client report", body: i.title, ref: null, status: "confirmed", private: false, created_at: i.created_at }, ...(i.id === "i-46" ? [{ id: `${i.id}-e2`, seq: 2, level: 4, kind: "code_ref", title: "ue_inv_tax_fields.js loads subsidiary id 2 for every invoice", body: "beforeLoad hardcodes the Indonesian subsidiary, so SG invoices print the ID tax registration number.", ref: { file: "src/FileCabinet/SuiteScripts/acme/ue_inv_tax_fields.js", line: 21 }, status: "confirmed", private: false, created_at: i.created_at + 600_000 }]
      : i.evidence_level >= 2 ? [{ id: `${i.id}-e2`, seq: 2, level: 2, kind: "execution_log", title: "Error visible in execution log", body: "Error repeats within the reported time range.", ref: { query: "SELECT ... FROM scriptexecutionlog ..." }, status: "proposed", private: false, created_at: i.created_at + 600_000 }] : [])] : [],
    hypotheses: i.id === "i-46" ? [{ id: `${i.id}-h1`, statement: "The tax number comes from a hardcoded subsidiary id instead of the invoice's subsidiary.", confidence: 0.95, status: "accepted" }]
      : i.evidence_level >= 2 ? [{ id: `${i.id}-h1`, statement: "The process runs inside a loop with record.load/save per row, exhausting governance.", confidence: 0.55, status: "open" }] : [],
    sessions: session ? [session] : [],
  };
}

export function stepsFor(sessionId: string): Step[] {
  if (sessionId === "s-42") return steps42;
  const i = issues.find((x) => `s-${x.id}` === sessionId);
  if (!i) return [];
  const base: Step[] = [
    { id: `${sessionId}-1`, seq: 1, state: "TRIAGE", kind: "llm", title: "Triage", summary: `${i.category ?? "unknown"} · ${i.severity ?? "-"} · ${i.module_area ?? "-"}. Plan: lookup_error_pattern → get_record_automation → get_execution_logs`, status: "done", started_at: i.created_at + 60_000, ended_at: i.created_at + 70_000, usage: tot(1, 2980, 380, 0, 0, 0.0049), toolCalls: [] },
    { id: `${sessionId}-2`, seq: 2, state: "TRIAGE", kind: "transition", title: "TRIAGE → INVESTIGATE", summary: "", status: "done", started_at: i.created_at + 70_000, ended_at: i.created_at + 70_000, usage: null, toolCalls: [] },
    { id: `${sessionId}-3`, seq: 3, state: "INVESTIGATE", kind: "tool", title: "lookup_error_pattern", summary: "SSS_USAGE_LIMIT_EXCEEDED: Governance exhausted: record.load/save or search inside a loop.", status: "done", started_at: i.created_at + 80_000, ended_at: i.created_at + 80_000, usage: null, toolCalls: [] },
  ];
  if (i.status === "budget_exceeded") base.push({ id: `${sessionId}-4`, seq: 4, state: "INVESTIGATE", kind: "llm", title: "investigating · round 7", summary: "Issue budget insufficient ($0.0000 remaining, estimated $0.1840)", status: "failed", started_at: i.updated_at, ended_at: i.updated_at, usage: null, toolCalls: [] });
  if (i.id === "i-46") {
    const t = ago(12);
    base.splice(2, 1, { id: `${sessionId}-3`, seq: 3, state: "INVESTIGATE", kind: "tool", title: "read_code", summary: "src/FileCabinet/SuiteScripts/acme/ue_inv_tax_fields.js (lines 1-34 of 34)\nbeforeLoad loads subsidiary id 2 (ACME Indonesia) for every invoice.", status: "done", started_at: i.created_at + 80_000, ended_at: i.created_at + 80_000, usage: null, toolCalls: [] });
    base.push(
      { id: `${sessionId}-f1`, seq: 5, state: "FIX", kind: "tool", title: "git_branch_and_patch", summary: `Patch applied on nsic/ACME-46: ${approval46.files.join(", ")}`, status: "done", started_at: t, ended_at: t + 900, usage: null, toolCalls: [{ id: "tc-46-patch", tool: "git_branch_and_patch", risk: "local_write", input: { rationale: "Read the tax number from the invoice's own subsidiary instead of the hardcoded id 2." }, output_preview: "Patch applied on nsic/ACME-46", ok: true, duration_ms: 880 }] },
      { id: `${sessionId}-f2`, seq: 6, state: "VALIDATE", kind: "tool", title: "Validation", summary: "run_tests: exit 0, 12 passed\nsdf_validate: Validation of account customization project was successful.", status: "done", started_at: t + 60_000, ended_at: t + 118_000, usage: null, toolCalls: [] },
      { id: `${sessionId}-f3`, seq: 7, state: "VALIDATE", kind: "transition", title: "VALIDATE → AWAIT_DEPLOY_APPROVAL", summary: "validation passed, awaiting deploy approval", status: "done", started_at: ago(4), ended_at: ago(4), usage: null, toolCalls: [{ id: approval46.toolCallId, tool: "sdf_deploy_sandbox", risk: "remote_write_sandbox", input: { pending: true }, output_preview: null, ok: null, duration_ms: null }] },
    );
  }
  if (i.status === "investigating") base.push({ id: `${sessionId}-4`, seq: 4, state: "INVESTIGATE", kind: "tool", title: "search_code", summary: "src/FileCabinet/SuiteScripts/acme/mr_invoice_reminder.js\n  for (let i = 0; i < 1000; i++) { const inv = «record».«load»(...", status: "done", started_at: ago(2), ended_at: ago(2), usage: null, toolCalls: [] });
  return base;
}

/** Minimal markdown for fixtures (production is rendered server-side with Bun.markdown, no raw HTML). */
export function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
  return md
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
      if (lines[0]!.startsWith("**") && lines.length > 1 && lines.slice(1).every((l) => /^\s*[-*] /.test(l))) return `<p>${inline(lines[0]!)}</p><ul>${lines.slice(1).map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
      return `<p>${inline(block).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

export const projectDetail = (id: string): ProjectDetail => {
  const p = projects.find((x) => x.id === id);
  if (!p) throw { code: "not_found", message: "project not found", status: 404 };
  return { ...p, environments: envs.filter((e) => e.project_id === id), repos: repos.filter((r) => r.project_id === id) };
};

// ───────── Usage, settings ─────────
export function usageFixture() {
  const days = Array.from({ length: 18 }, (_, k) => {
    const d = new Date(NOW - (17 - k) * 86400_000);
    const cost = [0.4, 1.2, 0.2, 0, 0, 2.1, 1.4, 0.9, 3.0, 0.3, 0, 0.1, 1.8, 2.6, 0.7, 1.1, 0.5, 1.3][k]!;
    return { ...tot(Math.round(cost * 12), Math.round(cost * 9000), Math.round(cost * 2100), Math.round(cost * 1200), Math.round(cost * 30000), cost), day: d.toISOString().slice(0, 10) };
  });
  const byIssue = issueRows().map((r) => ({ ...tot(Math.round((r.cost_usd ?? 0) * 12), Math.round((r.cost_usd ?? 0) * 14000), Math.round((r.cost_usd ?? 0) * 3000), 900, Math.round((r.cost_usd ?? 0) * 40000), r.cost_usd ?? 0), issue_id: r.id, key: r.key, title: r.title })).sort((a, b) => b.cost_usd - a.cost_usd);
  const total = byIssue.reduce((n, r) => n + r.cost_usd, 0);
  return {
    totals: { ...tot(118, 124_300, 26_900, 18_400, 402_800, total), issues: byIssue.length },
    byIssue,
    byModel: [{ ...tot(64, 88_000, 21_000, 18_400, 380_000, total * 0.78), model: "claude-sonnet-5" }, { ...tot(50, 34_000, 5_200, 0, 22_800, total * 0.12), model: "claude-haiku-4-5" }, { ...tot(4, 2_300, 700, 0, 0, total * 0.1), model: "claude-opus-5" }],
    byPurpose: [{ ...tot(58, 80_000, 19_000, 18_000, 380_000, total * 0.71), purpose: "agent" }, { ...tot(26, 21_000, 3_900, 0, 0, total * 0.12), purpose: "ingest" }, { ...tot(10, 9_000, 1_200, 0, 0, total * 0.05), purpose: "triage" }, { ...tot(14, 6_000, 1_600, 0, 12_000, total * 0.06), purpose: "consultant" }, { ...tot(10, 8_300, 1_200, 400, 10_800, total * 0.06), purpose: "report" }],
    daily: days,
    cacheHitRatio: 402_800 / (124_300 + 402_800 + 18_400),
  };
}

export const settingsFixture = {
  models: { agent_main: "claude-sonnet-5", agent_escalation: "claude-opus-5", ingest: "claude-haiku-4-5", triage: "claude-haiku-4-5", intent: "claude-haiku-4-5", consultant: "claude-haiku-4-5", report_writer: "claude-sonnet-5", max_tokens: { agent_main: 16000, agent_escalation: 16000, ingest: 4000, triage: 4000, intent: 1000, consultant: 2000, report_writer: 8000 } },
  llm: { engine: "api" as "api" | "claude-code" | "codex", profiles: {
    api: { agent_main: "claude-sonnet-5", agent_escalation: "claude-opus-5", ingest: "claude-haiku-4-5", triage: "claude-haiku-4-5", intent: "claude-haiku-4-5", consultant: "claude-haiku-4-5", report_writer: "claude-sonnet-5", max_tokens: { agent_main: 16000, agent_escalation: 16000, ingest: 4000, triage: 4000, intent: 1000, consultant: 2000, report_writer: 8000 } },
    "claude-code": { agent_main: "claude-sonnet-5", agent_escalation: "claude-opus-5", ingest: "claude-haiku-4-5", triage: "claude-haiku-4-5", intent: "claude-haiku-4-5", consultant: "claude-haiku-4-5", report_writer: "claude-sonnet-5", max_tokens: { agent_main: 16000, agent_escalation: 16000, ingest: 4000, triage: 4000, intent: 1000, consultant: 2000, report_writer: 8000 } },
    codex: { agent_main: "gpt-5.6-terra", agent_escalation: "gpt-5.6-sol", ingest: "gpt-5.6-luna", triage: "gpt-5.6-luna", intent: "gpt-5.6-luna", consultant: "gpt-5.6-luna", report_writer: "gpt-5.6-terra", max_tokens: { agent_main: 16000, agent_escalation: 16000, ingest: 4000, triage: 4000, intent: 1000, consultant: 2000, report_writer: 8000 } },
  } },
  pricing: [
    { model: "claude-haiku-4-5", input_per_mtok: 1, output_per_mtok: 5, cache_write_per_mtok: 1.25, cache_read_per_mtok: 0.1, note: null },
    { model: "claude-opus-5", input_per_mtok: 5, output_per_mtok: 25, cache_write_per_mtok: 6.25, cache_read_per_mtok: 0.5, note: null },
    { model: "claude-sonnet-5", input_per_mtok: 2, output_per_mtok: 10, cache_write_per_mtok: 2.5, cache_read_per_mtok: 0.2, note: null },
  ],
  general: { brandName: "NSIC", preparedBy: "NSIC", maxToolCalls: 60, maxDurationMin: 20, monthlyBudgetUsd: null as number | null, spikePerPoll: 20 },
  check: [
    { name: "Bun", ok: true, detail: "1.4.2", needed: "everything" },
    { name: "git", ok: true, detail: "git version 2.50.1", needed: "M1 repo pairing" },
    { name: "Chrome/Chromium", ok: true, detail: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", needed: "M4 browser runner, PDF" },
    { name: "ffmpeg", ok: false, detail: "not found (brew install ffmpeg / apt install ffmpeg)", needed: "M6 video MP4" },
    { name: "SuiteCloud CLI", ok: true, detail: "/usr/local/bin/suitecloud", needed: "tier A/B validate, deploy" },
    { name: "Java", ok: true, detail: "/usr/bin/java", needed: "SuiteCloud CLI" },
    { name: "LLM engine", ok: true, detail: "Messages API, ANTHROPIC_API_KEY set", needed: "agent, ingest LLM, consultant" },
    { name: "NSIC_MASTER_KEY", ok: true, detail: "set", needed: "credential storage" },
  ],
};

export const SAMPLE_PEM = "-----BEGIN CERTIFICATE-----\nMIIBqzCCAVGgAwIBAgIQJc0yQx3q2e8v8mZ0xX9fjTAKBggqhkjOPQQDAjAuMRkw\nFwYDVQQDDBBuc2ljLTEyMzQ1NjdfU0IxMREwDwYDVQQKDAhOU0lDIChjb250b2gp\n...sample, not a real certificate...\n-----END CERTIFICATE-----\n";
