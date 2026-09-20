// /api/issues/:id/reports, /api/reports, /api/usage, /api/settings, system check, audit, jobs (13 §1).
import { $ } from "bun";
import { s } from "../lib/schema.ts";
import { dataPath } from "../lib/fs.ts";
import { body, h, json, notFound, q, HttpError, currentCsrf, CSRF_COOKIE } from "./http.ts";
import { getIssueByKeyOrId } from "../db/repo/issues.ts";
import { getReportDraft, insertReportDraft, latestReportDraft, updateReportDraft } from "../db/repo/reports.ts";
import { usageReport } from "../db/repo/usage.ts";
import { deletePricing, getSetting, listPricing, putSetting, upsertPricing } from "../db/repo/settings.ts";
import { listAudit } from "../db/repo/audit.ts";
import { recentJobs } from "../db/repo/jobs.ts";
import { enqueueJob } from "../jobs/enqueue.ts";
import { buildReportModel, type ReportOptions } from "../reports/model.ts";
import { writeNarrative, applyOverrides, EDITABLE_KEYS } from "../reports/narrative.ts";
import { renderReportHtml } from "../reports/html.ts";
import { llmSettings, modelSettings, saveLlmSettings, saveModelSettings } from "../llm/models.ts";
import { cacheHitRatio } from "../llm/usage.ts";
import { config } from "../config.ts";
import { llmStatus } from "../llm/anthropic.ts";
import { chromePath } from "../browser/driver.ts";
import { ffmpegPath } from "../browser/recorder.ts";

const ReportOpts = s.object({
  formats: s.array(s.enum(["pdf", "xlsx", "md", "zip"] as const), { min: 1 }),
  audience: s.enum(["internal", "client"] as const),
  includeCost: s.boolean().optional(),
  redactedOnly: s.boolean().optional(),
  finalize: s.boolean().optional(),
});

const modelName = s.string({ min: 1, max: 100, pattern: /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/ });
const LlmModels = s.object({
  agent_main: modelName, agent_escalation: modelName, ingest: modelName, triage: modelName,
  intent: modelName, consultant: modelName, report_writer: modelName,
  max_tokens: s.object({
    agent_main: s.number({ int: true, min: 1, max: 200000 }), agent_escalation: s.number({ int: true, min: 1, max: 200000 }),
    ingest: s.number({ int: true, min: 1, max: 200000 }), triage: s.number({ int: true, min: 1, max: 200000 }),
    intent: s.number({ int: true, min: 1, max: 200000 }), consultant: s.number({ int: true, min: 1, max: 200000 }),
    report_writer: s.number({ int: true, min: 1, max: 200000 }),
  }, { strict: true }),
}, { strict: true });

async function systemCheck() {
  const which = async (cmd: string[]) => {
    const r = await $`${cmd}`.nothrow().quiet();
    return r.exitCode === 0 ? r.stdout.toString().trim().split("\n")[0]!.slice(0, 120) : null;
  };
  const cfg = config();
  const llm = llmStatus();
  const chrome = chromePath(cfg.chromePath);
  const ff = ffmpegPath();
  const sc = cfg.suitecloudPath ?? Bun.which("suitecloud");
  return [
    { name: "Bun", ok: true, detail: Bun.version, needed: "everything" },
    { name: "git", ok: !!(await which(["git", "--version"])), detail: await which(["git", "--version"]), needed: "M1 repo pairing" },
    { name: "Chrome/Chromium", ok: !!chrome, detail: chrome ?? "not found (set CHROME_PATH)", needed: "M4 browser runner, PDF" },
    { name: "ffmpeg", ok: !!ff, detail: ff ?? "not found (brew install ffmpeg / apt install ffmpeg)", needed: "M6 video MP4" },
    { name: "SuiteCloud CLI", ok: !!sc, detail: sc ?? "not found (npm i -g @oracle/suitecloud-cli)", needed: "tier A/B validate, deploy" },
    { name: "Java", ok: !!(await which(["java", "-version"])) || !!Bun.which("java"), detail: Bun.which("java") ?? "not found", needed: "SuiteCloud CLI" },
    { name: "LLM engine", ok: llm.ok, detail: llm.detail, needed: "agent, ingest LLM, consultant" },
    { name: "NSIC_MASTER_KEY", ok: !!cfg.masterKeyB64, detail: cfg.masterKeyB64 ? "set" : "empty in .env (bun run nsic init)", needed: "credential storage" },
  ];
}

export const systemRoutes = {
  "/api/session": {
    GET: h(() => json({ csrf: currentCsrf(), version: "0.1.0" }, 200, { "set-cookie": `${CSRF_COOKIE}=${currentCsrf()}; Path=/; SameSite=Strict; HttpOnly` })),
  },
  "/api/issues/:id/reports": {
    POST: h(async (req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      const b = await body(req, ReportOpts);
      const opts: ReportOptions = { formats: b.formats, audience: b.audience, includeCost: b.audience === "client" ? false : (b.includeCost ?? false), redactedOnly: b.redactedOnly ?? b.audience === "client" };
      const model = await writeNarrative(i.id, buildReportModel(i.id, opts));
      const d = insertReportDraft({ issue_id: i.id, options: opts, model });
      if (b.finalize) enqueueJob("build_report", { issueId: i.id, draftId: d.id }, { priority: 6, maxAttempts: 1 });
      return json(d, 201);
    }),
  },
  "/api/issues/:id/reports/preview": {
    GET: h((req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      const d = (q(req).get("draft") ? getReportDraft(q(req).get("draft")!) : latestReportDraft(i.id)) ?? notFound("draft report");
      const m = applyOverrides(d.model as never, d.overrides);
      const html = renderReportHtml(m, (id) => `/api/artifacts/${id}/file`, { editable: q(req).get("edit") === "1" && d.status === "draft" });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; font-src 'self'", "cache-control": "no-store" } });
    }),
  },
  "/api/reports/:id": {
    GET: h((req) => json(getReportDraft(req.params.id!) ?? notFound("draft report"))),
    PATCH: h(async (req) => {
      const d = getReportDraft(req.params.id!) ?? notFound("draft report");
      if (d.status === "final") throw new HttpError(409, "final", "The report is already final");
      const b = await body(req, s.object({ overrides: s.record(s.string({ max: 4000 })) }));
      const clean = Object.fromEntries(Object.entries(b.overrides).filter(([k]) => (EDITABLE_KEYS as readonly string[]).includes(k)));
      return json(updateReportDraft(d.id, { overrides: { ...(d.overrides ?? {}), ...clean } }));
    }),
  },
  "/api/reports/:id/finalize": {
    POST: h(async (req) => {
      const d = getReportDraft(req.params.id!) ?? notFound("draft report");
      const b = await body(req, s.object({ overrides: s.record(s.string({ max: 4000 })).optional() }));
      if (b.overrides) updateReportDraft(d.id, { overrides: { ...(d.overrides ?? {}), ...b.overrides } });
      return json(enqueueJob("build_report", { issueId: d.issue_id, draftId: d.id }, { priority: 6, maxAttempts: 1 }), 202);
    }),
  },
  "/api/usage": {
    GET: h((req) => {
      const p = q(req);
      const nowD = new Date();
      const from = Number(p.get("from") ?? new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime());
      const to = Number(p.get("to") ?? Date.now() + 1);
      const r = usageReport({ from, to, ...(p.get("project") ? { projectId: p.get("project")! } : {}) });
      return json({ from, to, ...r, cacheHitRatio: cacheHitRatio(r.totals) });
    }),
  },
  "/api/settings/models": {
    GET: h(() => json(modelSettings())),
    PUT: h(async (req) => {
      const b = await body(req, LlmModels);
      saveModelSettings(b);
      return json(modelSettings());
    }),
  },
  "/api/settings/llm": {
    GET: h(() => json(llmSettings())),
    PUT: h(async (req) => {
      const b = await body(req, s.object({ engine: s.enum(["api", "claude-code", "codex"] as const), models: LlmModels }, { strict: true }));
      saveLlmSettings(b.engine, b.models);
      return json(llmSettings());
    }),
  },
  "/api/settings/pricing": {
    GET: h(() => json(listPricing())),
    PUT: h(async (req) => {
      const b = await body(req, s.array(s.object({ model: s.string({ min: 3, max: 100 }), input_per_mtok: s.number({ min: 0 }), output_per_mtok: s.number({ min: 0 }), cache_write_per_mtok: s.number({ min: 0 }), cache_read_per_mtok: s.number({ min: 0 }), note: s.string().nullable().optional(), delete: s.boolean().optional() })));
      for (const p of b) p.delete ? deletePricing(p.model) : upsertPricing(p);
      return json(listPricing());
    }),
  },
  "/api/settings/general": {
    GET: h(() =>
      json({
        brandName: getSetting("report.brand_name", "NSIC"),
        preparedBy: getSetting("report.prepared_by", "NSIC"),
        maxToolCalls: getSetting("agent.max_tool_calls", 60),
        maxDurationMin: getSetting("agent.max_duration_min", 20),
        monthlyBudgetUsd: getSetting<number | null>("budget.monthly_usd", null),
        spikePerPoll: getSetting("monitor.spike_per_poll", 20),
      }),
    ),
    PUT: h(async (req) => {
      const b = await body(req, s.object({ brandName: s.string({ max: 80 }).optional(), preparedBy: s.string({ max: 80 }).optional(), maxToolCalls: s.number({ int: true, min: 5, max: 500 }).optional(), maxDurationMin: s.number({ int: true, min: 1, max: 240 }).optional(), monthlyBudgetUsd: s.number({ min: 0 }).nullable().optional(), spikePerPoll: s.number({ int: true, min: 1 }).optional() }));
      const map: Record<string, string> = { brandName: "report.brand_name", preparedBy: "report.prepared_by", maxToolCalls: "agent.max_tool_calls", maxDurationMin: "agent.max_duration_min", monthlyBudgetUsd: "budget.monthly_usd", spikePerPoll: "monitor.spike_per_poll" };
      for (const [k, v] of Object.entries(b)) if (v !== undefined) putSetting(map[k]!, v);
      return json({ ok: true });
    }),
  },
  "/api/system/check": { GET: h(async () => json(await systemCheck())) },
  "/api/audit": {
    GET: h((req) => {
      const p = q(req);
      return json(listAudit({ ...(p.get("issue") && { issueId: p.get("issue")! }), ...(p.get("environment") && { environmentId: p.get("environment")! }), ...(p.get("action") && { action: p.get("action")! }), limit: Number(p.get("limit") ?? 200) }));
    }),
  },
  "/api/jobs": { GET: h(() => json(recentJobs(100))) },
  "/api/data-dir": { GET: h(() => json({ dataDir: dataPath() })) },
};
