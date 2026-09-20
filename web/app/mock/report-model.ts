// Sample ReportModel for report preview in static mode (shape = src/reports/model.ts).
import type { ReportModel } from "../../../src/reports/model.ts";
import { ago, artifacts42 } from "./fixtures.ts";

export function sampleReportModel(audience: "internal" | "client" = "internal"): ReportModel {
  const shots = artifacts42.filter((a) => a.kind === "screenshot");
  return {
    meta: { issueKey: "ACME-42", title: "Vendor bill VB-1042 fails to approve", project: "ACME Manufacturing", client: "PT Acme Indonesia", environment: "SB1", envKind: "sandbox", preparedBy: "NSIC", preparedAt: Date.now(), audience, includeCost: audience === "internal", brandName: "NSIC", timezone: "Asia/Jakarta" },
    answer: {
      status: "root_caused",
      evidenceLevel: 4,
      oneLine: "Two user event scripts re-save the same vendor bill during approval, so the second save is rejected by NetSuite.",
      rootCause: "`customscript_acme_ue_vb_approval` (ue_vb_approval.js:13) and `customscript_acme_ue_vb_sync_ap` (ue_vb_sync_ap.js:12) both load then save the bill in afterSubmit. The second save uses a stale record version and is rejected with **RCRD_HAS_BEEN_CHANGED**.\n\n- Observation: 14 errors in the execution log Sep 11-12 from the AP sync script.\n- Hypothesis refuted: the approval workflow does not re-save the record.\n- Recommendation: replace `record.load` + `save` with `record.submitFields` in both scripts.",
      fix: null,
      verification: null,
    },
    timeline: [
      { at: ago(95), actor: "Developer", event: "Issue created", detail: "Vendor bill VB-1042 fails to approve" },
      { at: ago(88.8), actor: "Agent", event: "TRIAGE → INVESTIGATE", detail: "bug · high · P2P" },
      { at: ago(86.5), actor: "Agent", event: "INVESTIGATE → HYPOTHESIZE", detail: "Two afterSubmit UEs load and save the same bill." },
      { at: ago(84), actor: "Runner", event: "Browser reproduce run", detail: "symptom appeared at step 5" },
      { at: ago(17), actor: "Agent", event: "ROOT_CAUSE → REPORT_DRAFT", detail: "Root cause pinpointed to two file:line locations with a mechanism." },
    ],
    evidence: [
      { id: "ev4", seq: 4, level: 4, kind: "code_ref", title: "ue_vb_approval.js afterSubmit loads and re-saves the bill", body: "Save to stamp the approver changes the record's version.", ref: audience === "client" ? "ue_vb_approval.js:13" : "src/FileCabinet/SuiteScripts/acme/ue_vb_approval.js:13", status: "confirmed", artifactIds: [] },
      { id: "ev5", seq: 5, level: 4, kind: "code_ref", title: "ue_vb_sync_ap.js afterSubmit also saves the same bill", body: "The second save is rejected: RCRD_HAS_BEEN_CHANGED.", ref: "ue_vb_sync_ap.js:12", status: "proposed", artifactIds: [] },
      { id: "ev6", seq: 6, level: 3, kind: "repro_run", title: "Symptom appears when replayed in SB1", body: "\"Record has been changed\" banner after clicking Approve.", ref: "run reproduce", status: "confirmed", artifactIds: [] },
      { id: "ev2", seq: 2, level: 2, kind: "execution_log", title: "14 RCRD_HAS_BEEN_CHANGED errors from the AP sync script", body: "Sep 11-12, afterSubmit event.", ref: "SELECT … FROM scriptexecutionlog …", status: "confirmed", artifactIds: [] },
      { id: "ev1", seq: 1, level: 1, kind: "client_report", title: "Structured client report", body: "VB-1042 and 6 other bills over 100 million failed to approve since Sep 12.", ref: "", status: "confirmed", artifactIds: [] },
    ],
    steps: shots.map((a) => ({ index: a.step_index ?? 0, caption: a.caption ?? "", screenshotPath: a.storage_path, status: "passed", note: null, artifactId: a.id })),
    beforeAfter: [],
    qa: [{ question: "Why can't VB-1042 be approved? When will it be fixed?", answer: "We found the cause: two automated scripts modify the same bill almost at the same time. The fix is being tested in sandbox first; release schedule to follow." }],
    usage: audience === "internal" ? { byPurpose: [{ purpose: "agent", tokens: 112_400, cost: 0.9120 }, { purpose: "ingest", tokens: 14_200, cost: 0.1840 }, { purpose: "triage", tokens: 3_532, cost: 0.0052 }, { purpose: "report", tokens: 25_664, cost: 0.1828 }], byModel: [], total: { tokens: 155_796, cost: 1.284 }, calls: [] } : null,
    caveats: ["The fix has not yet been verified with a replay in sandbox.", "Production is read-only; the deploy order in production has not been compared."],
    narrative: { titleClaim: "Vendor bill approval fails because two scripts save the same record", causeIntro: "Both scripts run on the same afterSubmit event and don't wait for each other.", evidenceIntro: "Evidence is ordered from highest level, 5 items.", stepsIntro: "Each image shows one step; the clicked element is highlighted.", fixIntro: "" },
    artifacts: [],
  };
}
