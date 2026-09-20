// Demo seed data: two projects with issues spanning every status/flow, so the UI can be reviewed end to end
// without a real NetSuite account. Run with: bun run db:seed-demo (safe to re-run; it replaces its own data).
import { db } from "../db/db.ts";
import { now } from "../lib/ids.ts";
import { createProject, updateProject } from "../db/repo/projects.ts";
import { createEnvironment, insertAccessProfile } from "../db/repo/environments.ts";
import { createIssue, updateIssue, deleteIssue } from "../db/repo/issues.ts";
import { insertEntity } from "../db/repo/entities.ts";
import { insertEvidence } from "../db/repo/evidence.ts";
import { upsertHypothesis } from "../db/repo/evidence.ts";
import { createSession, startStep, finishStep, insertToolCall, finishToolCall, updateSession } from "../db/repo/sessions.ts";
import { addMessage } from "../db/repo/threads.ts";
import { insertLlmCall } from "../db/repo/usage.ts";
import { audit } from "../db/repo/audit.ts";
import { upsertMemory } from "../db/repo/memory.ts";
import { insertReportDraft, updateReportDraft } from "../db/repo/reports.ts";
import { upsertPricing } from "../db/repo/settings.ts";
import { storeUpload } from "../ingest/pipeline.ts";

const ago = (min: number) => now() - Math.round(min * 60_000);
// Backdate rows so the Inbox, Usage chart and step timelines show a realistic history.
// Column names vary per table (created_at/updated_at vs started_at/ended_at).
const TIME_COLS: Record<string, [string, string]> = {
  issues: ["created_at", "updated_at"],
  evidence: ["created_at", "created_at"],
  llm_calls: ["created_at", "created_at"],
  projects: ["created_at", "created_at"],
  agent_sessions: ["started_at", "ended_at"],
  agent_steps: ["started_at", "ended_at"],
};
const stamp = (table: string, id: string, at: number, at2?: number) => {
  const [c1, c2] = TIME_COLS[table]!;
  if (at2 !== undefined && c2 !== c1) db().query(`UPDATE ${table} SET ${c1} = ?, ${c2} = ? WHERE id = ?`).run(at, at2, id);
  else db().query(`UPDATE ${table} SET ${c1} = ? WHERE id = ?`).run(at, id);
};
// Set evidence_level without touching updated_at (unlike the repo's recomputeEvidenceLevel), so backdated issues stay backdated.
const setEvidenceLevel = (issueId: string) =>
  db().query("UPDATE issues SET evidence_level = (SELECT COALESCE(MAX(level),0) FROM evidence WHERE issue_id = ? AND status != 'rejected') WHERE id = ?").run(issueId, issueId);

function purgeExisting() {
  const rows = db().query("SELECT id FROM projects WHERE notes = 'nsic-demo-seed'").all() as { id: string }[];
  for (const p of rows) {
    for (const i of db().query("SELECT id FROM issues WHERE project_id = ?").all(p.id) as { id: string }[]) deleteIssue(i.id);
    db().query("DELETE FROM environments WHERE project_id = ?").run(p.id);
    db().query("DELETE FROM repos WHERE project_id = ?").run(p.id);
    db().query("DELETE FROM projects WHERE id = ?").run(p.id);
  }
}

async function main() {
  purgeExisting();

  upsertPricing({ model: "claude-haiku-4-5", input_per_mtok: 1, output_per_mtok: 5, cache_write_per_mtok: 1.25, cache_read_per_mtok: 0.1 });
  upsertPricing({ model: "claude-sonnet-5", input_per_mtok: 2, output_per_mtok: 10, cache_write_per_mtok: 2.5, cache_read_per_mtok: 0.2 });
  upsertPricing({ model: "claude-opus-5", input_per_mtok: 5, output_per_mtok: 25, cache_write_per_mtok: 6.25, cache_read_per_mtok: 0.5 });

  // ───────── Projects & environments ─────────
  const acme = createProject({ name: "ACME Manufacturing", client_name: "PT Acme Indonesia", key_prefix: "ACME", default_budget_usd: 3, notes: "nsic-demo-seed" });
  const nus = createProject({ name: "Nusantara Retail", client_name: "Nusantara Retail Group", key_prefix: "NUS", default_budget_usd: 2, notes: "nsic-demo-seed" });
  stamp("projects", acme.id, ago(60 * 24 * 40));
  stamp("projects", nus.id, ago(60 * 24 * 12));

  const acmeSb1 = createEnvironment({ project_id: acme.id, name: "SB1", kind: "sandbox", account_id: "1234567_SB1", timezone: "Asia/Jakarta" });
  const acmeProd = createEnvironment({ project_id: acme.id, name: "Production", kind: "production", account_id: "1234567", timezone: "Asia/Jakarta" });
  const nusSb = createEnvironment({ project_id: nus.id, name: "Sandbox", kind: "sandbox", account_id: "7654321_SB2", timezone: "Asia/Jakarta" });

  insertAccessProfile({ environment_id: acmeSb1.id, tier: "A", capabilities: { mcp: true, suiteql: true, rest_record: true, exec_logs: true, sdf: true, browser_session: true, repo: true }, mcp_tools: ["ns_getRecord", "ns_runCustomSuiteQL", "ns_listSavedSearches", "ns_runSavedSearch", "ns_getRecordTypeMetadata"], role_name: "NSIC Integration (SB1)", probe_log: "mcp: 5 tools\nsuiteql: ok\nrest_record: ok\nexec_logs: ok\nsdf: CLI available\nbrowser: session active" });
  insertAccessProfile({ environment_id: acmeProd.id, tier: "P", capabilities: { mcp: true, suiteql: true, rest_record: true, exec_logs: true, sdf: false, browser_session: true, repo: true }, mcp_tools: ["ns_getRecord", "ns_runCustomSuiteQL", "ns_listSavedSearches", "ns_runSavedSearch"], role_name: "NSIC Integration (Production, read-only)", probe_log: "mcp: 4 tools\nsuiteql: ok\nrest_record: ok\nexec_logs: ok\nsdf: authId not saved yet\nbrowser: session active" });
  insertAccessProfile({ environment_id: nusSb.id, tier: "C", capabilities: { mcp: false, suiteql: false, rest_record: false, exec_logs: false, sdf: false, browser_session: true, repo: false }, mcp_tools: [], role_name: null, probe_log: "mcp: no OAuth token yet\nsuiteql: no M2M credentials yet\nrest_record: no M2M credentials yet\nexec_logs: requires SuiteQL\nsdf: authId not saved yet\nbrowser: session active" });

  // ───────── ACME-42: fully worked bug, root-caused, awaiting user direction ─────────
  const i42 = createIssue({
    project_id: acme.id, environment_id: acmeSb1.id, priority: "high",
    title: "Vendor bill VB-1042 fails to approve: Record has been changed",
    reporter: "Rina (Finance)",
    description: "From an email from Rina (Finance), Sep 12, 2026:\n\nHi, since yesterday we haven't been able to approve vendor bill VB-1042 and several other bills over 100 million. Every time we click Approve we get an error \"Record has been changed\". We've tried retrying and logging out, same result. The role used is A/P Clerk. Please check, this is holding up supplier payments this week.",
  });
  updateIssue(i42.id, {
    status: "root_caused", category: "bug", severity: "high", module_area: "P2P",
    root_cause: "Approval of VB-1042 fails because two user event scripts save the same vendor bill again in afterSubmit.\n\n`customscript_acme_ue_vb_approval` (ue_vb_approval.js:13) and `customscript_acme_ue_vb_sync_ap` (ue_vb_sync_ap.js:12) both perform `record.load` then `save()` on the bill being approved. The second save is rejected by NetSuite with RCRD_HAS_BEEN_CHANGED (#E4, #E5). The symptom was reproduced in SB1 (#E6).\n\n**Limitations**\n- Not yet verified in production; only read access was used there.",
    triage: { category: "bug", severity: "high", module_area: "P2P", suspected_record_types: ["vendorbill"], plan: ["get_record_automation on vendorbill to map active UE scripts/workflows", "get_execution_logs Sep 11-12 for RCRD_HAS_BEEN_CHANGED errors", "suiteql_query system notes for VB-1042 around the approval time", "read_code the afterSubmit of each UE script that saves the record", "reproduce the approval in SB1 with the A/P Clerk role"], missing_info: ["Does this happen for all subsidiaries?"] },
    questions_for_client: ["Does the error occur on all vendor bills or only those over 100 million?", "Were there any script or approval workflow changes last week?"],
  });
  stamp("issues", i42.id, ago(95), ago(6));

  insertEntity({ issue_id: i42.id, type: "transaction_no", value: "VB-1042", normalized: "VB-1042", source_attachment_id: null, source_locator: "email body line 3", confidence: 0.95, status: "confirmed" });
  insertEntity({ issue_id: i42.id, type: "error_message", value: "Record has been changed", normalized: "Record has been changed", source_attachment_id: null, source_locator: "screenshot-approve.png", confidence: 0.9, status: "confirmed" });
  insertEntity({ issue_id: i42.id, type: "error_code", value: "RCRD_HAS_BEEN_CHANGED", normalized: "RCRD_HAS_BEEN_CHANGED", source_attachment_id: null, source_locator: "inferred", confidence: 0.6, status: "auto" });
  insertEntity({ issue_id: i42.id, type: "role", value: "A/P Clerk", normalized: "A/P Clerk", source_attachment_id: null, source_locator: "email body line 5", confidence: 0.7, status: "auto" });
  insertEntity({ issue_id: i42.id, type: "internal_id", value: "88213", normalized: "88213", source_attachment_id: null, source_locator: "vendbill.nl?id=88213", confidence: 0.9, status: "auto" });

  const email1 = await storeUpload(i42.id, { name: "RE_ Approval VB-1042 failed.eml", data: new TextEncoder().encode("From: Rina (Finance)\nSubject: RE: Approval VB-1042 failed\n\nHi, since yesterday we haven't been able to approve vendor bill VB-1042...\n"), mime: "message/rfc822" }, "upload");
  const shot1 = await storeUpload(i42.id, { name: "screenshot-approve.png", data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), mime: "image/png" }, "email_child", email1.attachment.id);
  const xlsx1 = await storeUpload(i42.id, { name: "list-of-failed-bills.xlsx", data: new TextEncoder().encode("VB-1042,VB-1043,VB-1044,VB-1045,VB-1046,VB-1047,VB-1048"), mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, "upload");
  const msg1 = await storeUpload(i42.id, { name: "notes.msg", data: new TextEncoder().encode("(unsupported Outlook binary format placeholder)"), mime: "application/vnd.ms-outlook" }, "upload");
  db().query("UPDATE attachments SET ingest_status='done', summary=? WHERE id=?").run("Email from Rina (Finance): VB-1042 and several bills over 100 million have failed to approve since Sep 12 with the error \"Record has been changed\".", email1.attachment.id);
  db().query("UPDATE attachments SET ingest_status='done', summary=? WHERE id=?").run("Screenshot of the VB-1042 form showing the \"Record has been changed\" error banner after clicking Approve.", shot1.attachment.id);
  db().query("UPDATE attachments SET ingest_status='done', summary=? WHERE id=?").run("7 vendor bills failing approval, all valued over IDR 100 million, subsidiary ACME Indonesia.", xlsx1.attachment.id);
  db().query("UPDATE attachments SET ingest_status='unsupported', summary=? WHERE id=?").run("The .msg (Outlook) file isn't supported yet. Save the email as .eml and re-upload.", msg1.attachment.id);

  const e1 = insertEvidence({ issue_id: i42.id, level: 1, kind: "client_report", title: "Structured client report", body: "VB-1042 and 6 other bills over 100 million have failed to approve since Sep 12 with \"Record has been changed\".", status: "confirmed" });
  stamp("evidence", e1.id, ago(92));
  const e2 = insertEvidence({ issue_id: i42.id, level: 2, kind: "execution_log", title: "14 RCRD_HAS_BEEN_CHANGED errors from customscript_acme_ue_vb_sync_ap", body: "All errors occurred Sep 11-12 on the afterSubmit event, right after the new ue_vb_approval version was deployed (Sep 10).", ref: { query: "SELECT sel.date, sel.title, s.scriptid FROM scriptexecutionlog sel ... WHERE sel.type IN ('ERROR')" }, status: "confirmed" });
  stamp("evidence", e2.id, ago(70));
  const e3 = insertEvidence({ issue_id: i42.id, level: 2, kind: "system_note", title: "System notes for VB-1042: two changes in the same second", body: "Sep 12 09:14:03 approvalstatus → Approved (A/P Clerk), 09:14:03 custbody_acme_approved_by set by script.", ref: { query: "SELECT sn.date, sn.field ... FROM systemnote sn WHERE sn.recordid = 88213" }, status: "proposed", private: true });
  stamp("evidence", e3.id, ago(62));
  const e4 = insertEvidence({ issue_id: i42.id, level: 4, kind: "code_ref", title: "ue_vb_approval.js afterSubmit loads and re-saves the bill", body: "afterSubmit on APPROVE calls record.load(VENDOR_BILL) then bill.save() to stamp custbody_acme_approved_by. This save changes the record's version.", ref: { file: "src/FileCabinet/SuiteScripts/acme/ue_vb_approval.js", line: 13, scriptid: "customscript_acme_ue_vb_approval" }, status: "confirmed" });
  stamp("evidence", e4.id, ago(20));
  const e5 = insertEvidence({ issue_id: i42.id, level: 4, kind: "code_ref", title: "ue_vb_sync_ap.js afterSubmit also saves the same bill", body: "When approvalstatus = 2, the script loads the bill and calls save() to set custbody_acme_ap_synced. Because it runs after the approval UE, the second save is rejected: RCRD_HAS_BEEN_CHANGED.", ref: { file: "src/FileCabinet/SuiteScripts/acme/ue_vb_sync_ap.js", line: 12, scriptid: "customscript_acme_ue_vb_sync_ap" }, status: "proposed" });
  stamp("evidence", e5.id, ago(18));
  const e6 = insertEvidence({ issue_id: i42.id, level: 3, kind: "repro_run", title: "Symptom appears when replaying the reproduction in SB1", body: "Clicking Approve on VB-1042 (clone) produces the \"Record has been changed\" banner.", status: "confirmed" });
  stamp("evidence", e6.id, ago(26));
  setEvidenceLevel(i42.id);

  upsertHypothesis({ issue_id: i42.id, statement: "Two afterSubmit user events (approval stamp + AP sync) load and save the same bill, so the second save is rejected.", confidence: 0.9, status: "accepted", supporting: [e4.id, e5.id, e6.id] });
  upsertHypothesis({ issue_id: i42.id, statement: "The ACME Vendor Bill Approval workflow changes approvalstatus at the same time as the script.", confidence: 0.2, status: "refuted", refuting: [e3.id] });
  upsertHypothesis({ issue_id: i42.id, statement: "The 100 million threshold triggers a CFO validation in beforeSubmit that fails.", confidence: 0.1, status: "refuted" });

  const s42 = createSession({ issue_id: i42.id, trigger: "auto", state: "AWAIT_USER", model_main: "claude-sonnet-5" });
  updateSession(s42.id, { status: "awaiting_user" });
  stamp("agent_sessions", s42.id, ago(90));
  const step = (state: string, kind: "llm" | "tool" | "transition", title: string, summary: string, startMin: number, endMin: number) => {
    const st = startStep({ session_id: s42.id, state, kind, title, summary });
    finishStep(st.id, { status: "done", summary });
    stamp("agent_steps", st.id, ago(startMin), ago(endMin));
    return st;
  };
  step("TRIAGE", "llm", "Triage", "bug · high · P2P. Plan: get_record_automation vendorbill → get_execution_logs Sep 11-12 → system notes VB-1042 → read_code afterSubmit → reproduce approval in SB1", 89, 88.8);
  step("TRIAGE", "transition", "TRIAGE → INVESTIGATE", "", 88.8, 88.8);
  step("INVESTIGATE", "llm", "investigating · round 1", "Starting from automation on vendorbill, then checking the execution log in the reported time range.", 88.7, 88.5);
  const stAuto = step("INVESTIGATE", "tool", "get_record_automation", "3 automations: customscript_acme_ue_vb_approval (UE, RELEASED), customscript_acme_ue_vb_sync_ap (UE, RELEASED), customworkflow_acme_vb_approval (workflow)", 88.5, 88.5);
  const tc1 = insertToolCall({ step_id: stAuto.id, tool: "get_record_automation", risk: "read", input: { record_type: "vendorbill" } });
  finishToolCall(tc1.id, { ok: true, output_preview: '{"items":[{"scriptid":"customscript_acme_ue_vb_approval","objectType":"usereventscript"},{"scriptid":"customscript_acme_ue_vb_sync_ap","objectType":"usereventscript"}]}', duration_ms: 42 });
  const stLogs = step("INVESTIGATE", "tool", "get_execution_logs", "14 log entries: RCRD_HAS_BEEN_CHANGED from customscript_acme_ue_vb_sync_ap, Sep 11-12", 88.4, 88.1);
  const tc2 = insertToolCall({ step_id: stLogs.id, tool: "get_execution_logs", risk: "read", input: { script_id: null, from: "2026-09-11", to: "2026-09-12", level: "ERROR" } });
  finishToolCall(tc2.id, { ok: true, output_preview: '14 log entries\n[{"date":"12/9/2026 09:14","type":"ERROR","title":"RCRD_HAS_BEEN_CHANGED","scriptid":"customscript_acme_ue_vb_sync_ap"}]', duration_ms: 2140 });
  step("INVESTIGATE", "tool", "add_evidence", "Evidence #E2 saved. Issue evidence level is now E2.", 88, 88);
  const stSql = step("INVESTIGATE", "tool", "suiteql_query", "6 rows of system notes for VB-1042 at 12 Sep 09:14:03", 87.6, 87.2);
  const tc3 = insertToolCall({ step_id: stSql.id, tool: "suiteql_query", risk: "read", input: { query: "SELECT sn.date, BUILTIN.DF(sn.name) AS who, sn.field, sn.oldvalue, sn.newvalue FROM systemnote sn WHERE sn.recordid = 88213 ORDER BY sn.date DESC", limit: 50 } });
  finishToolCall(tc3.id, { ok: true, output_preview: '6 rows\n[{"date":"12/9/2026 09:14:03","who":"Rina","field":"approvalstatus"}]', duration_ms: 1260 });
  const stRead = step("INVESTIGATE", "tool", "read_code", "src/FileCabinet/SuiteScripts/acme/ue_vb_sync_ap.js (lines 1-29 of 29)", 87, 87);
  const tc4 = insertToolCall({ step_id: stRead.id, tool: "read_code", risk: "read", input: { path: "src/FileCabinet/SuiteScripts/acme/ue_vb_sync_ap.js" } });
  finishToolCall(tc4.id, { ok: true, output_preview: "    9    const status = context.newRecord.getValue({ fieldId: 'approvalstatus' });\n   10    if (String(status) !== '2') return;\n   11    const bill = record.load({ type: record.Type.VENDOR_BILL, id });\n   12    bill.setValue({ fieldId: 'custbody_acme_ap_synced', value: true });\n   13    bill.save({ ignoreMandatoryFields: true });", duration_ms: 8 });
  step("INVESTIGATE", "transition", "INVESTIGATE → HYPOTHESIZE", "Two afterSubmit UEs load+save the same bill; logs and system notes are consistent.", 86.5, 86.5);
  step("HYPOTHESIZE", "tool", "update_hypotheses", "h1 70% [open] Two afterSubmit user events ...\nh2 20% [open] Approval workflow ...\nh3 10% [open] CFO validation ...", 86, 86);
  step("HYPOTHESIZE", "transition", "HYPOTHESIZE → REPRODUCE", "Strongest hypothesis at 70%; reproducing in SB1 adds evidence.", 85.8, 85.8);
  step("REPRODUCE", "tool", "write_repro_script", "Repro script v1 saved (6 steps).", 85, 85);
  step("REPRODUCE", "tool", "run_repro", "Run run-1 (reproduce) status failed.\n1. navigate passed\n2. wait passed\n3. assert passed\n4. click passed\n5. expectError passed errors=[\"RCRD_HAS_BEEN_CHANGED\"]", 84, 82.5);
  step("REPRODUCE", "transition", "REPRODUCE → ROOT_CAUSE", "Symptom appears when approving in SB1 (#E6).", 82, 82);
  step("ROOT_CAUSE", "llm", "root cause · round 1", "Cause: afterSubmit ordering. ue_vb_approval saves the bill first; ue_vb_sync_ap loads the stale version and its save is rejected.", 22, 21.5);
  step("ROOT_CAUSE", "tool", "add_evidence", "Evidence #E4 saved. Issue evidence level is now E4.", 20, 20);
  step("ROOT_CAUSE", "transition", "ROOT_CAUSE → REPORT_DRAFT", "Root cause pinpointed to two file:line locations with a mechanism.", 17, 17);
  step("REPORT_DRAFT", "llm", "Root cause summary", "Approval of VB-1042 fails because two user event scripts save the same vendor bill again in afterSubmit.", 16, 15.6);
  step("REPORT_DRAFT", "transition", "REPORT_DRAFT → AWAIT_USER", "Waiting for direction: final capture or fix.", 15.5, 15.5);

  addMessage(i42.id, "agent", { role: "system_event", content: "Agent session started automatically after 4 attachments were processed." });
  addMessage(i42.id, "agent", { role: "user", content: "Also check the approval workflow, maybe a workflow is setting the status at the same time." });
  addMessage(i42.id, "agent", { role: "system_event", content: "Direction noted; the agent will read it on the next round." });
  addMessage(i42.id, "agent", { role: "system_event", content: "Browser reproduce run finished: failed. The symptom appeared at step 5." });
  addMessage(i42.id, "agent", {
    role: "assistant",
    content: "**Approval of VB-1042 fails because two user event scripts save the same vendor bill again in afterSubmit.**\n\n`customscript_acme_ue_vb_approval` (ue_vb_approval.js:13) loads and saves the bill to stamp the approver. After that, `customscript_acme_ue_vb_sync_ap` (ue_vb_sync_ap.js:12) loads the stale version and saves it again, so NetSuite rejects it with RCRD_HAS_BEEN_CHANGED (#E4, #E5). The approval workflow doesn't change the same field (h2 refuted).\n\n**Next steps**\n- Final capture for screenshot and video evidence.\n- Fix: replace `record.load + save` with `record.submitFields` in both scripts.\n- Confirm with the client whether there was a deploy change on Sep 10.",
    meta: { kind: "root_cause" },
  });
  addMessage(i42.id, "agent", { role: "assistant", content: "Root cause is at E4 and the symptom has been reproduced. Where should we go next?", meta: { checkpoint: true, options: ["Final capture", "Draft a fix in sandbox", "Ask the client first"] } });

  addMessage(i42.id, "consultant", { role: "user", content: "Hey, any idea why VB-1042 can't be approved? The client is asking when it'll be fixed.", meta: { tone: "casual" } });
  addMessage(i42.id, "consultant", {
    role: "assistant",
    content: "We found the cause: during approval, two automated scripts modify the same bill almost at the same time, so NetSuite rejects the save with \"Record has been changed\". I'll test the fix in sandbox first; once it passes verification, I'll share the release schedule to production.",
    meta: { question: "Hey, any idea why VB-1042 can't be approved? The client is asking when it'll be fixed.", cited: ["#E4", "#E5", "#E6"], confidence_note: "ETA not yet set by the developer.", held: false, violations: [], faq: true },
  });

  audit("agent", "browser.run", { issueId: i42.id, environmentId: acmeSb1.id, detail: { mode: "reproduce", status: "failed" } });
  audit("agent", "tool.call", { issueId: i42.id, environmentId: acmeSb1.id, detail: { tool: "suiteql_query" } });

  // ───────── ACME-41: resolved a while ago (issue memory demo) ─────────
  const i41 = createIssue({ project_id: acme.id, environment_id: acmeSb1.id, title: "Sales order discount doesn't save when customer is changed", reporter: "Sari (Sales Ops)", priority: "normal" });
  updateIssue(i41.id, { status: "resolved", category: "bug", severity: "medium", module_area: "O2C", root_cause: "The client script recalculates the discount in `fieldChanged` for the customer field, but writes it to a field id that only exists on the old form (`custbody_acme_discount_pct_v1`); the current form uses `custbody_acme_discount_pct_v2`.", resolution: "Updated `cs_so_discount.js` to write to `custbody_acme_discount_pct_v2` and added a fallback for accounts still on the old form. Verified in SB1 with three test orders." });
  stamp("issues", i41.id, ago(60 * 24 * 6), ago(60 * 24 * 2));
  const e41 = insertEvidence({ issue_id: i41.id, level: 5, kind: "test_result", title: "Fix verified with three test sales orders in SB1", body: "Discount now persists across all three subsidiaries tested.", status: "confirmed" });
  stamp("evidence", e41.id, ago(60 * 24 * 2.2));
  setEvidenceLevel(i41.id);
  upsertMemory({ issue_id: i41.id, project_id: acme.id, symptoms: "Sales order discount doesn't save when the customer field is changed after entry.", root_cause: "Client script writes the recalculated discount to a field id that only exists on an older transaction form.", fix_summary: "Write to the current form's discount field id, with a fallback for the old form.", files: JSON.stringify(["src/FileCabinet/SuiteScripts/acme/cs_so_discount.js"]), error_codes: null });
  const rd41 = insertReportDraft({ issue_id: i41.id, options: { formats: ["pdf"], audience: "client", includeCost: false, redactedOnly: true }, model: { title: "Sales order discount fix", summary: "Fixed and verified in sandbox." } });
  updateReportDraft(rd41.id, { status: "final" });

  // ───────── ACME-43: actively investigating ─────────
  const i43 = createIssue({ project_id: acme.id, environment_id: acmeSb1.id, title: "Map/Reduce invoice reminder stops midway: SSS_USAGE_LIMIT_EXCEEDED", reporter: "Budi (AR)", priority: "normal" });
  updateIssue(i43.id, { status: "investigating", category: "governance", severity: "medium", module_area: "O2C" });
  stamp("issues", i43.id, ago(40), ago(1));
  const e43 = insertEvidence({ issue_id: i43.id, level: 1, kind: "client_report", title: "Structured client report", body: "The daily invoice reminder job stops partway through the customer list with a governance error.", status: "confirmed" });
  stamp("evidence", e43.id, ago(39));
  setEvidenceLevel(i43.id);
  const s43 = createSession({ issue_id: i43.id, trigger: "auto", state: "INVESTIGATE", model_main: "claude-sonnet-5" });
  stamp("agent_sessions", s43.id, ago(38));
  const st43a = startStep({ session_id: s43.id, state: "TRIAGE", kind: "llm", title: "Triage", summary: "governance · medium · O2C. Plan: lookup_error_pattern → get_record_automation → get_execution_logs" });
  finishStep(st43a.id, { status: "done" });
  stamp("agent_steps", st43a.id, ago(38), ago(37.8));
  const st43b = startStep({ session_id: s43.id, state: "INVESTIGATE", kind: "tool", title: "lookup_error_pattern", summary: "SSS_USAGE_LIMIT_EXCEEDED: Governance exhausted: record.load/save or search inside a loop." });
  finishStep(st43b.id, { status: "done" });
  stamp("agent_steps", st43b.id, ago(37), ago(37));
  const st43c = startStep({ session_id: s43.id, state: "INVESTIGATE", kind: "tool", title: "search_code", summary: "src/FileCabinet/SuiteScripts/acme/mr_invoice_reminder.js\n  for (let i = 0; i < 1000; i++) { const inv = record.load(...) }" });
  finishStep(st43c.id, { status: "done" });
  stamp("agent_steps", st43c.id, ago(2), ago(2));

  // ───────── ACME-44: budget exceeded ─────────
  const i44 = createIssue({ project_id: acme.id, environment_id: acmeSb1.id, title: "AP sync integration sends duplicate bills to the bank system", reporter: "Rina (Finance)", priority: "urgent", budget_usd: 3 });
  updateIssue(i44.id, { status: "budget_exceeded", category: "integration", severity: "high", module_area: "integration" });
  stamp("issues", i44.id, ago(60 * 26), ago(60 * 20));
  const e44 = insertEvidence({ issue_id: i44.id, level: 2, kind: "execution_log", title: "Duplicate outbound calls logged for the same bill id", body: "The RESTlet integration log shows the same bill posted twice within 4 seconds.", status: "confirmed" });
  stamp("evidence", e44.id, ago(60 * 21));
  setEvidenceLevel(i44.id);
  const s44 = createSession({ issue_id: i44.id, trigger: "auto", state: "INVESTIGATE", model_main: "claude-sonnet-5" });
  updateSession(s44.id, { status: "budget_exceeded", error: "Issue budget insufficient ($0.0000 remaining, estimated $0.1840)" });
  stamp("agent_sessions", s44.id, ago(60 * 25));
  const st44 = startStep({ session_id: s44.id, state: "INVESTIGATE", kind: "llm", title: "investigating · round 7", summary: "Issue budget insufficient ($0.0000 remaining, estimated $0.1840)" });
  finishStep(st44.id, { status: "failed" });
  stamp("agent_steps", st44.id, ago(60 * 20), ago(60 * 20));
  audit("system", "budget.exceeded", { issueId: i44.id, detail: { budget_usd: 3, spent_usd: 3.012 } });

  // ───────── ACME-45: monitor-triggered, awaiting user, browser action blocked ─────────
  const i45 = createIssue({ project_id: acme.id, environment_id: acmeProd.id, title: "[Monitor] customscript_acme_mr_invoice_reminder: SSS_USAGE_LIMIT_EXCEEDED", priority: "high" });
  updateIssue(i45.id, { status: "awaiting_user", category: "governance", severity: "high", module_area: "O2C" });
  stamp("issues", i45.id, ago(60 * 9), ago(60 * 8));
  const e45 = insertEvidence({ issue_id: i45.id, level: 3, kind: "execution_log", title: "Recurring SSS_USAGE_LIMIT_EXCEEDED in production", body: "The same governance error recurs daily around 02:00 Asia/Jakarta.", status: "confirmed" });
  stamp("evidence", e45.id, ago(60 * 8.5));
  setEvidenceLevel(i45.id);
  const s45 = createSession({ issue_id: i45.id, trigger: "monitor", state: "AWAIT_USER", model_main: "claude-sonnet-5" });
  updateSession(s45.id, { status: "awaiting_user" });
  stamp("agent_sessions", s45.id, ago(60 * 9));
  audit("agent", "browser.blocked", { issueId: i45.id, environmentId: acmeProd.id, detail: { reason: "the \"Save\" button is a write action", target: "btn_multibutton_submitter" } });
  addMessage(i45.id, "agent", { role: "system_event", content: "Detected automatically by the production monitor." });
  addMessage(i45.id, "agent", { role: "assistant", content: "This is a production environment; I can only read data here. Approve a read-only investigation, or should I reproduce this in SB1 instead?", meta: { checkpoint: true, options: ["Investigate read-only in Production", "Reproduce in SB1"] } });

  // ───────── ACME-46: root-caused, fix drafted, awaiting deploy approval ─────────
  const i46 = createIssue({ project_id: acme.id, environment_id: acmeSb1.id, title: "Invoice PDF prints the ID tax number on SG subsidiary invoices", reporter: "Budi (AR)", priority: "high" });
  updateIssue(i46.id, { status: "fixing", category: "bug", severity: "medium", module_area: "O2C", root_cause: "The invoice template reads `custbody_acme_tax_reg_no` from the Indonesian subsidiary record, hardcoded as id 2 in `ue_inv_tax_fields.js:21`, instead of the invoice's own subsidiary." });
  stamp("issues", i46.id, ago(60 * 3), ago(4));
  insertEntity({ issue_id: i46.id, type: "script_id", value: "customscript_acme_ue_inv_tax_fields", normalized: null, source_attachment_id: null, source_locator: "description", confidence: 0.9, status: "confirmed" });
  const e46a = insertEvidence({ issue_id: i46.id, level: 1, kind: "client_report", title: "Structured client report", body: "Invoice PDF prints the ID tax number on SG subsidiary invoices", status: "confirmed" });
  stamp("evidence", e46a.id, ago(60 * 3 - 1));
  const e46b = insertEvidence({ issue_id: i46.id, level: 4, kind: "code_ref", title: "ue_inv_tax_fields.js loads subsidiary id 2 for every invoice", body: "beforeLoad hardcodes the Indonesian subsidiary, so SG invoices print the ID tax registration number.", ref: { file: "src/FileCabinet/SuiteScripts/acme/ue_inv_tax_fields.js", line: 21 }, status: "confirmed" });
  stamp("evidence", e46b.id, ago(60 * 3 - 10));
  setEvidenceLevel(i46.id);
  upsertHypothesis({ issue_id: i46.id, statement: "The tax number comes from a hardcoded subsidiary id instead of the invoice's subsidiary.", confidence: 0.95, status: "accepted", supporting: [e46b.id] });
  const s46 = createSession({ issue_id: i46.id, trigger: "fix", state: "AWAIT_DEPLOY_APPROVAL", model_main: "claude-sonnet-5" });
  updateSession(s46.id, { status: "awaiting_user" });
  stamp("agent_sessions", s46.id, ago(60 * 3 - 20));
  const stFix = startStep({ session_id: s46.id, state: "FIX", kind: "tool", title: "git_branch_and_patch", summary: "Patch applied on nsic/ACME-46: src/FileCabinet/SuiteScripts/acme/ue_inv_tax_fields.js" });
  finishStep(stFix.id, { status: "done" });
  stamp("agent_steps", stFix.id, ago(12), ago(11.98));
  const tcPatch = insertToolCall({ step_id: stFix.id, tool: "git_branch_and_patch", risk: "local_write", input: { rationale: "Read the tax number from the invoice's own subsidiary instead of the hardcoded id 2." } });
  finishToolCall(tcPatch.id, { ok: true, output_preview: "Patch applied on nsic/ACME-46", duration_ms: 880 });
  const stVal = startStep({ session_id: s46.id, state: "VALIDATE", kind: "tool", title: "Validation", summary: "run_tests: exit 0, 12 passed\nsdf_validate: Validation of account customization project was successful." });
  finishStep(stVal.id, { status: "done" });
  stamp("agent_steps", stVal.id, ago(11), ago(9.03));
  const stDeploy = startStep({ session_id: s46.id, state: "VALIDATE", kind: "transition", title: "VALIDATE → AWAIT_DEPLOY_APPROVAL", summary: "validation passed, awaiting deploy approval" });
  finishStep(stDeploy.id, { status: "done" });
  stamp("agent_steps", stDeploy.id, ago(4), ago(4));
  const tcDeploy = insertToolCall({ step_id: stDeploy.id, tool: "sdf_deploy_sandbox", risk: "remote_write_sandbox", input: { pending: true } });
  addMessage(i46.id, "agent", { role: "system_event", content: "Fix session started from the Fix action." });
  addMessage(i46.id, "agent", { role: "assistant", content: "Validation passed. Approve deploy to sandbox?", meta: { checkpoint: true, options: ["Approve", "Reject"], state: "AWAIT_DEPLOY_APPROVAL", approval: { toolCallId: tcDeploy.id, branch: "nsic/ACME-46", files: ["src/FileCabinet/SuiteScripts/acme/ue_inv_tax_fields.js"], objects: ["customscript_acme_ue_inv_tax_fields"], diff: "--- a/src/FileCabinet/SuiteScripts/acme/ue_inv_tax_fields.js\n+++ b/src/FileCabinet/SuiteScripts/acme/ue_inv_tax_fields.js\n@@ -18,7 +18,8 @@\n-    const sub = record.load({ type: record.Type.SUBSIDIARY, id: 2 });\n+    const subId = inv.getValue({ fieldId: 'subsidiary' });\n+    const sub = record.load({ type: record.Type.SUBSIDIARY, id: subId });\n" } } });

  // ───────── ACME-40: closed long ago (permission issue) ─────────
  const i40 = createIssue({ project_id: acme.id, environment_id: acmeProd.id, title: "A/P Clerk role can't see the Approval History tab", reporter: "Rina (Finance)", priority: "low" });
  updateIssue(i40.id, { status: "closed", category: "permission", severity: "low", module_area: "P2P", root_cause: "The A/P Clerk role is missing View permission on the \"Approval History\" subtab custom segment.", resolution: "Added View permission to the role via SDF; confirmed with the client that the tab is now visible." });
  stamp("issues", i40.id, ago(60 * 24 * 14), ago(60 * 24 * 10));
  setEvidenceLevel(i40.id);

  // ───────── NUS-7: config issue awaiting client answers ─────────
  const in7 = createIssue({ project_id: nus.id, environment_id: nusSb.id, title: "Tax Invoice Number field missing from the invoice form", reporter: "Consultant: Dewi", priority: "high" });
  updateIssue(in7.id, { status: "awaiting_user", category: "config", severity: "medium", module_area: "O2C", questions_for_client: ["Which transaction form is used for these invoices?", "Was the Faktur Pajak bundle installed on this account?"] });
  stamp("issues", in7.id, ago(60 * 5), ago(60 * 2));
  const en7 = insertEntity({ issue_id: in7.id, type: "record_type", value: "invoice", normalized: "invoice", source_attachment_id: null, source_locator: "description", confidence: 0.8, status: "auto" });
  const e7a = insertEvidence({ issue_id: in7.id, level: 1, kind: "client_report", title: "Structured client report", body: "Tax Invoice Number field missing from the invoice form", status: "confirmed" });
  stamp("evidence", e7a.id, ago(60 * 5 - 5));
  const e7b = insertEvidence({ issue_id: in7.id, level: 2, kind: "config_ref", title: "Field not present on the custom transaction form", body: "The custom invoice form used by this subsidiary doesn't include custbody_faktur_pajak_no.", status: "proposed" });
  stamp("evidence", e7b.id, ago(60 * 2.5));
  setEvidenceLevel(in7.id);

  // ───────── NUS-8: fresh, still ingesting attachments ─────────
  const in8 = createIssue({ project_id: nus.id, environment_id: nusSb.id, title: "Stock-by-location report differs from the saved search", reporter: "Consultant: Dewi", priority: "normal" });
  updateIssue(in8.id, { status: "ingesting" });
  stamp("issues", in8.id, ago(2), ago(1));
  const xlsxN8 = await storeUpload(in8.id, { name: "stock-by-location.xlsx", data: new TextEncoder().encode("Location,SKU,Qty\nWarehouse A,SKU-1,120\nWarehouse B,SKU-1,40"), mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, "upload");
  db().query("UPDATE attachments SET ingest_status='running' WHERE id=?").run(xlsxN8.attachment.id);
  const pngN8 = await storeUpload(in8.id, { name: "saved-search.png", data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), mime: "image/png" }, "paste");
  db().query("UPDATE attachments SET ingest_status='pending' WHERE id=?").run(pngN8.attachment.id);

  // ───────── LLM usage across the last 18 days, for the Usage dashboard ─────────
  const purposes = ["agent", "ingest", "triage", "consultant", "report"] as const;
  const models = ["claude-sonnet-5", "claude-haiku-4-5", "claude-opus-5"] as const;
  const rate: Record<(typeof models)[number], { in: number; out: number }> = { "claude-sonnet-5": { in: 2, out: 10 }, "claude-haiku-4-5": { in: 1, out: 5 }, "claude-opus-5": { in: 5, out: 25 } };
  const allIssues = [i42, i41, i43, i44, i45, i46, i40, in7, in8];
  for (let day = 17; day >= 0; day--) {
    const callsToday = 2 + Math.round(Math.random() * 6);
    for (let k = 0; k < callsToday; k++) {
      const issue = allIssues[Math.floor(Math.random() * allIssues.length)]!;
      const purpose = purposes[Math.floor(Math.random() * purposes.length)]!;
      const model = purpose === "ingest" || purpose === "triage" ? "claude-haiku-4-5" : models[Math.floor(Math.random() * models.length)]!;
      const input_tokens = 800 + Math.round(Math.random() * 6000);
      const output_tokens = 150 + Math.round(Math.random() * 1200);
      const cache_read_tokens = Math.round(Math.random() * 20000);
      const r = rate[model];
      const cost_usd = (input_tokens * r.in + output_tokens * r.out) / 1_000_000 + (cache_read_tokens * 0.1) / 1_000_000;
      const call = insertLlmCall({ issue_id: issue.id, session_id: null, step_id: null, purpose, model, input_tokens, output_tokens, cache_write_tokens: 0, cache_read_tokens, cost_usd: Math.round(cost_usd * 1_000_000) / 1_000_000, pricing_snapshot: null, latency_ms: 400 + Math.round(Math.random() * 4000), stop_reason: "end_turn", request_id: null });
      stamp("llm_calls", call.id, ago(day * 24 * 60 + Math.round(Math.random() * 24 * 60)));
    }
  }

  // ───────── Audit trail ─────────
  audit("user", "credential.decrypt", { environmentId: acmeSb1.id, detail: { kind: "mcp_oauth" } });
  audit("agent", "sdf.deploy", { issueId: i46.id, environmentId: acmeSb1.id, detail: { branch: "nsic/ACME-46", target: "SB1" } });
  audit("user", "export.create", { issueId: i41.id, detail: { format: "pdf", audience: "client" } });

  updateProject(acme.id, { notes: "nsic-demo-seed" });
  updateProject(nus.id, { notes: "nsic-demo-seed" });

  console.log("Demo data seeded:");
  console.log(`  Projects: ${acme.name} (${acme.id}), ${nus.name} (${nus.id})`);
  console.log(`  Issues: ${allIssues.length}`);
  console.log("Run: bun run dev, then open the app.");
}

if (import.meta.main) await main();
