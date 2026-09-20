// MVP pipeline end to end with a scripted LLM: repo index → issue + attachments → ingest → agent session
// (TRIAGE → INVESTIGATE → HYPOTHESIZE → ROOT_CAUSE → REPORT_DRAFT) → chat → Markdown/XLSX export.
// No NetSuite access (tier none): the agent works from attachments and the SDF repo, as in the M2 DoD.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTransport } from "../../src/llm/anthropic.ts";
import { DEFAULT_PRICING } from "../../src/llm/models.ts";
import { upsertPricing } from "../../src/db/repo/settings.ts";
import { createProject } from "../../src/db/repo/projects.ts";
import { createRepo } from "../../src/db/repo/code.ts";
import { indexRepo } from "../../src/repo/indexer.ts";
import { createIssue, getIssue, updateIssue } from "../../src/db/repo/issues.ts";
import { listEntities } from "../../src/db/repo/entities.ts";
import { listAttachments } from "../../src/db/repo/attachments.ts";
import { listEvidence, listHypotheses } from "../../src/db/repo/evidence.ts";
import { getSession, listToolCallsForSession } from "../../src/db/repo/sessions.ts";
import { listMessages } from "../../src/db/repo/threads.ts";
import { insertReportDraft } from "../../src/db/repo/reports.ts";
import { storeUpload, ingestIssue } from "../../src/ingest/pipeline.ts";
import { startAgentSession } from "../../src/agent/start.ts";
import { runSession } from "../../src/agent/orchestrator.ts";
import { postAgentMessage } from "../../src/agent/chat.ts";
import { buildReportModel } from "../../src/reports/model.ts";
import { buildReport } from "../../src/reports/builder.ts";
import { dataPath } from "../../src/lib/fs.ts";
import { db } from "../../src/db/db.ts";
import { scriptedTransport, toolResultsAfter, type Script } from "../helpers/scripted-llm.ts";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "sdf-repo");
const SYNC = "src/FileCabinet/SuiteScripts/acme/ue_vb_sync_ap.js";
const APPROVAL = "src/FileCabinet/SuiteScripts/acme/ue_vb_approval.js";

const EMAIL = [
  "From: Rina <rina@acme.example>",
  "To: support@partner.example",
  "Subject: VB-1042 cannot be approved",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hi, we cannot approve vendor bill VB-1042 (internal id 1042). Clicking Approve shows",
  '"Record has been changed". Role: A/P Clerk. This blocks supplier payments this week.',
].join("\r\n");

const script: Script = {
  structured: {
    record_ingest_result: {
      summary: "Finance reports vendor bill VB-1042 fails on Approve with 'Record has been changed' for the A/P Clerk role.",
      entities: [
        { type: "transaction_no", value: "VB-1042", locator: "body line 1", confidence: 0.95 },
        { type: "error_message", value: "Record has been changed", locator: "body line 2", confidence: 0.95 },
        { type: "role", value: "A/P Clerk", locator: "body line 2", confidence: 0.9 },
      ],
      questions_for_client: ["Does it happen for bills under 100,000?"],
    },
    record_triage: {
      category: "bug",
      severity: "high",
      module_area: "P2P",
      suspected_record_types: ["vendorbill"],
      plan: ["List automation on vendorbill", "Read afterSubmit scripts that save the bill", "Pin the double save"],
      missing_info: [],
    },
    record_root_cause: {
      one_line: "Two afterSubmit user events reload and save VB-1042, so the second save fails with RCRD_HAS_BEEN_CHANGED.",
      root_cause_md: "ue_vb_approval.js:12 and ue_vb_sync_ap.js:12 both call record.load then save() on the approved bill (#E2).",
      limitations: ["Not observed in NetSuite logs: no live access in this environment."],
      recommended_next: ["Merge the two saves into one submitFields call"],
    },
    record_intent: { intent: "question" },
    record_report_text: {
      title_claim: "Vendor bill approval fails because two scripts save the same bill",
      one_line: "Two afterSubmit scripts save the approved bill; the second save is rejected.",
      cause_intro: "Both scripts reload the bill after approval and save it again.",
      evidence_intro: "The code references below show both saves.",
      steps_intro: "",
      fix_intro: "Replace the second load/save with record.submitFields.",
      caveats: [],
    },
  },
  agent: {
    INVESTIGATE: [
      [{ name: "get_record_automation", input: { record_type: "vendorbill" } }, { name: "search_code", input: { query: "VENDOR_BILL save" } }],
      [{ name: "read_code", input: { path: SYNC } }, { name: "read_code", input: { path: APPROVAL } }],
      [
        { name: "add_evidence", input: { level: 1, kind: "client_report", title: "Approve on VB-1042 fails with Record has been changed", body: "Reported by Finance for the A/P Clerk role." } },
        // A real model often records code-level evidence while still investigating (seen in the live smoke run).
        { name: "add_evidence", input: { level: 4, kind: "code_ref", title: "ue_vb_approval saves the bill in afterSubmit", body: "afterSubmit loads the approved vendor bill and saves it again, which bumps the record version.", ref: { file: APPROVAL, line: 12 } } },
        { name: "complete_state", input: { next: "HYPOTHESIZE", summary: "Two afterSubmit scripts on vendorbill reload and save the bill." } },
      ],
    ],
    HYPOTHESIZE: [
      [
        { name: "update_hypotheses", input: { hypotheses: [{ statement: "Two afterSubmit scripts save the same bill after approval", confidence: 0.8 }] } },
        { name: "complete_state", input: { next: "ROOT_CAUSE", summary: "Code evidence is sufficient." } },
      ],
    ],
    ROOT_CAUSE: [
      // First attempt breaks the E4 rule (no ref); the tool must reject it and the agent retries.
      [{ name: "add_evidence", input: { level: 4, kind: "code_ref", title: "Double save in afterSubmit", body: "Both scripts save the bill after approval, which conflicts." } }],
      [
        {
          name: "add_evidence",
          input: {
            level: 4,
            kind: "code_ref",
            title: "Double save in afterSubmit",
            body: "ue_vb_sync_ap afterSubmit loads the approved bill and saves it (line 12) after ue_vb_approval already saved it (line 12); the second save sees a stale version and NetSuite rejects it with RCRD_HAS_BEEN_CHANGED.",
            ref: { file: SYNC, line: 12, scriptid: "customscript_acme_ue_vb_sync_ap" },
          },
        },
        { name: "complete_state", input: { next: "REPORT_DRAFT", summary: "Root cause pinned to ue_vb_sync_ap.js:12." } },
      ],
    ],
  },
  text: () => "Proven: the double save (#E2). Unknown: whether logs show it in production.",
};

const rec = scriptedTransport(script);
let issueId = "";
let sessionId = "";

/** Issue status seen at every LLM call, to catch wrong intermediate labels. */
const statuses: string[] = [];

beforeAll(async () => {
  for (const p of DEFAULT_PRICING) upsertPricing(p);
  setTransport((req, h) => {
    if (issueId) statuses.push(getIssue(issueId)?.status ?? "?");
    return rec.transport(req, h);
  });
  const project = createProject({ name: "ACME", client_name: "Acme", key_prefix: "E2E", default_budget_usd: 3 });
  const repo = createRepo({ project_id: project.id, source: "local_path", location: FIXTURE });
  await indexRepo(repo.id);
  const issue = createIssue({ project_id: project.id, title: "VB-1042 cannot be approved", description: "See the forwarded email." });
  issueId = issue.id;
  await storeUpload(issueId, { name: "report.eml", data: new TextEncoder().encode(EMAIL), mime: "message/rfc822" }, "upload");
  await storeUpload(issueId, { name: "bills.csv", data: new TextEncoder().encode("bill,amount,status\nVB-1042,125000000,Pending Approval\n"), mime: "text/csv" }, "upload");
});

afterAll(() => setTransport(null));

describe("MVP pipeline (scripted LLM)", () => {
  test("ingest extracts a summary and entities from every attachment", async () => {
    await ingestIssue(issueId);
    const atts = listAttachments(issueId).filter((a) => !a.parent_id);
    expect(atts).toHaveLength(2);
    expect(atts.every((a) => a.ingest_status === "done")).toBe(true);
    const values = listEntities(issueId).map((e) => e.normalized ?? e.value);
    expect(values).toContain("VB-1042");
    // Client content reaches the model only inside <untrusted_content>.
    const ingestReq = rec.calls.find((c) => c.kind === "structured" && c.req.tool_choice?.type === "tool" && c.req.tool_choice.name === "record_ingest_result")!;
    expect(JSON.stringify(ingestReq.req.messages)).toContain("<untrusted_content");
  });

  test("agent session reaches E4 with a code reference and drafts the root cause", async () => {
    const { session } = startAgentSession(issueId, "manual");
    sessionId = session.id;
    await runSession(session.id, new AbortController().signal);

    const s = getSession(sessionId)!;
    expect(s.status).toBe("awaiting_user");
    expect(s.state).toBe("AWAIT_USER");

    const issue = getIssue(issueId)!;
    expect(issue.evidence_level).toBe(4);
    expect(issue.status).toBe("root_caused");
    expect(issue.triage?.suspected_record_types).toContain("vendorbill");
    expect(issue.root_cause).toContain("RCRD_HAS_BEEN_CHANGED");

    const e4 = listEvidence(issueId).filter((e) => e.level === 4).map((e) => (e.ref as { file: string }).file);
    expect(e4).toEqual([APPROVAL, SYNC]);
    // E4 from code analysis is not a reproduction: the issue must never be labelled "reproduced".
    expect(statuses).not.toContain("reproduced");
    expect(statuses).toContain("investigating");
    expect(listHypotheses(issueId)).toHaveLength(1);
  });

  test("tools ran against the real repo index", () => {
    const investigate = toolResultsAfter(rec.calls, "INVESTIGATE", 0);
    expect(investigate[0]!.content).toContain("customscript_acme_ue_vb_sync_ap");
    const reads = toolResultsAfter(rec.calls, "INVESTIGATE", 1);
    expect(reads[0]!.content).toContain("bill.save({ ignoreMandatoryFields: true })");
    expect(reads.every((r) => !r.is_error)).toBe(true);
  });

  test("the E4 evidence rule rejects a claim without a code reference", () => {
    const [r] = toolResultsAfter(rec.calls, "ROOT_CAUSE", 0);
    expect(r!.is_error).toBe(true);
    expect(r!.content).toContain("E4 requires");
    expect(listEvidence(issueId).filter((e) => e.level === 4)).toHaveLength(2);
  });

  test("context is assembled from the evidence board with a stable, cached prefix", () => {
    const agent = rec.calls.filter((c) => c.kind === "agent");
    expect(agent.length).toBeGreaterThanOrEqual(6);
    const toolLists = new Set(agent.map((c) => JSON.stringify(c.req.tools)));
    expect(toolLists.size).toBe(1); // same tool list in every state keeps the cache prefix valid
    const names = (agent[0]!.req.tools ?? []).map((t) => t.name);
    expect(names).not.toContain("suiteql_query"); // tier none: no NetSuite tools
    expect(names).not.toContain("git_branch_and_patch");
    const system = agent[0]!.req.system as { cache_control?: unknown }[];
    expect(system.filter((b) => b.cache_control)).toHaveLength(2);
    // A later state sees earlier findings through the board, not the old transcript.
    const rootCause = agent.find((c) => c.state === "ROOT_CAUSE")!;
    expect(rootCause.req.messages).toHaveLength(1);
    expect(JSON.stringify(rootCause.req.messages[0])).toContain("Two afterSubmit scripts save the same bill");
  });

  test("every LLM call is costed against the issue", () => {
    const rows = db().query("SELECT purpose, model, cost_usd FROM llm_calls WHERE issue_id = ?").all(issueId) as { purpose: string; model: string; cost_usd: number | null }[];
    const purposes = new Set(rows.map((r) => r.purpose));
    for (const p of ["ingest", "triage", "agent", "report"]) expect(purposes.has(p)).toBe(true);
    expect(rows.every((r) => (r.cost_usd ?? 0) > 0)).toBe(true);
    expect(rows.find((r) => r.purpose === "triage")!.model).toContain("haiku");
    expect(listToolCallsForSession(sessionId).length).toBeGreaterThanOrEqual(9);
  });

  test("a chat question is answered from the evidence board without tools", async () => {
    const before = rec.calls.length;
    const r = await postAgentMessage(issueId, "What is proven so far?");
    expect(r.ok).toBe(true);
    const textCall = rec.calls.slice(before).find((c) => c.kind === "text")!;
    expect(textCall.req.tools).toBeUndefined();
    expect(listMessages(issueId, "agent").at(-1)!.content).toContain("#E2");
  });

  test("Markdown and XLSX reports export with the root cause and evidence", async () => {
    const opts = { audience: "internal" as const, includeCost: true, redactedOnly: false, formats: ["md" as const, "xlsx" as const] };
    const d = insertReportDraft({ issue_id: issueId, options: opts, model: buildReportModel(issueId, opts) });
    const r = await buildReport(d.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const md = r.value.find((a) => a.kind === "report_md")!;
    const text = readFileSync(dataPath(md.storage_path), "utf8");
    expect(text).toContain("E4");
    expect(text).toContain("RCRD_HAS_BEEN_CHANGED");
    expect(text).toContain("AI usage:");
    expect(r.value.some((a) => a.kind === "report_xlsx")).toBe(true);
  });

  test("a client report leaves out cost and private evidence", async () => {
    const opts = { audience: "client" as const, includeCost: false, redactedOnly: true, formats: ["md" as const] };
    const m = buildReportModel(issueId, opts);
    expect(m.usage).toBeFalsy();
    // Milestones only: no agent state names in a client timeline.
    expect(m.timeline.some((t) => t.event.includes("→"))).toBe(false);
    expect(m.timeline.map((t) => t.event)).toContain("Findings summarized");
    // The draft's limitations appear once, in the Limitations section, not inside the cause.
    expect(m.answer.rootCause).not.toContain("Limitations");
    expect(m.caveats).toContain("Not observed in NetSuite logs: no live access in this environment.");
    const d = insertReportDraft({ issue_id: issueId, options: opts, model: m });
    const r = await buildReport(d.id);
    expect(r.ok).toBe(true);
  });

  test("budget exhaustion pauses the session instead of calling the model", async () => {
    const tight = createIssue({ project_id: getIssue(issueId)!.project_id, title: "Budget check", description: "x", budget_usd: 0.0001 });
    const before = rec.calls.length;
    const { session } = startAgentSession(tight.id, "manual");
    await runSession(session.id, new AbortController().signal);
    expect(getSession(session.id)!.status).toBe("budget_exceeded");
    expect(getIssue(tight.id)!.status).toBe("budget_exceeded");
    expect(rec.calls.length).toBe(before);
    updateIssue(tight.id, { budget_usd: 3 });
  });
});
