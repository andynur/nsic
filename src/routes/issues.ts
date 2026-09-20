// /api/issues, attachments, entities, evidence, repro scripts, runs, artifacts (13 §1).
import { s } from "../lib/schema.ts";
import { dataPath, removeIssueDir } from "../lib/fs.ts";
import { body, fileResponse, h, json, notFound, q, HttpError } from "./http.ts";
import { createIssue, deleteIssue, effectiveBudget, getIssue, getIssueByKeyOrId, ISSUE_STATUSES, listIssues, PRIORITIES, recomputeEvidenceLevel, updateIssue } from "../db/repo/issues.ts";
import { getProject } from "../db/repo/projects.ts";
import { getEnvironment, latestAccessProfile } from "../db/repo/environments.ts";
import { getAttachment, listAttachments, totalAttachmentBytes } from "../db/repo/attachments.ts";
import { getEntity, insertEntity, listEntities, updateEntity } from "../db/repo/entities.ts";
import { getEvidence, listEvidence, listHypotheses, updateEvidence } from "../db/repo/evidence.ts";
import { activeSession, listSessions } from "../db/repo/sessions.ts";
import { issueByPurpose, issueTotals } from "../db/repo/usage.ts";
import { getArtifact, getRun, insertReproScript, listArtifacts, listReproScripts, listRunArtifacts, listRuns, getReproScript } from "../db/repo/artifacts.ts";
import { cancelJobsFor } from "../db/repo/jobs.ts";
import { audit, listAudit } from "../db/repo/audit.ts";
import { enqueueJob } from "../jobs/enqueue.ts";
import { dispatcher } from "../jobs/dispatcher.ts";
import { LIMITS, storeUpload } from "../ingest/pipeline.ts";
import { validateDsl } from "../browser/dsl.ts";
import { checkScript, guardModeFor } from "../browser/guard.ts";
import { emit } from "../realtime/events.ts";
import { cacheHitRatio } from "../llm/usage.ts";
import { safeMarkdown } from "../reports/html.ts";

async function saveFiles(issueId: string, files: File[], source: "upload" | "paste") {
  const out = [];
  let total = totalAttachmentBytes(issueId);
  for (const f of files) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > LIMITS.perFileBytes) throw new HttpError(413, "file_too_large", `${f.name} is over 50 MB`);
    total += f.size;
    if (total > LIMITS.perIssueBytes) throw new HttpError(413, "issue_too_large", "The issue's attachments total more than 500 MB");
    out.push(await storeUpload(issueId, { name: f.name || `paste-${Date.now()}.png`, data: new Uint8Array(await f.arrayBuffer()), mime: f.type }, source));
  }
  return out;
}

function issueDetail(keyOrId: string) {
  const i = getIssueByKeyOrId(keyOrId) ?? notFound("issue");
  const env = i.environment_id ? getEnvironment(i.environment_id) : null;
  const profile = env ? latestAccessProfile(env.id) : null;
  const totals = issueTotals(i.id);
  return {
    issue: i,
    rootCauseHtml: i.root_cause ? safeMarkdown(i.root_cause) : null,
    project: getProject(i.project_id),
    environment: env ? { ...env, tier: profile?.tier ?? "none", capabilities: profile?.capabilities ?? {} } : null,
    entities: listEntities(i.id),
    attachments: listAttachments(i.id),
    evidence: listEvidence(i.id),
    hypotheses: listHypotheses(i.id),
    sessions: listSessions(i.id),
    activeSession: activeSession(i.id),
    usage: { totals, byPurpose: issueByPurpose(i.id), budget: effectiveBudget(i.id), cacheHitRatio: cacheHitRatio(totals) },
    artifacts: listArtifacts(i.id),
    runs: listRuns(i.id),
    reproScripts: listReproScripts(i.id),
    blocked: listAudit({ issueId: i.id, action: "browser.blocked", limit: 50 }).concat(listAudit({ issueId: i.id, action: "tool.blocked", limit: 50 })),
  };
}

const IssuePatch = s.object({
  title: s.string({ min: 3, max: 300 }).optional(),
  description: s.string({ max: 50_000 }).optional(),
  reporter: s.string({ max: 120 }).nullable().optional(),
  priority: s.enum(PRIORITIES).optional(),
  status: s.enum(ISSUE_STATUSES).optional(),
  environment_id: s.string().nullable().optional(),
  budget_usd: s.number({ min: 0, max: 1000 }).nullable().optional(),
  root_cause: s.string({ max: 20_000 }).nullable().optional(),
  resolution: s.string({ max: 20_000 }).nullable().optional(),
  add_budget_usd: s.number({ min: 0, max: 1000 }).optional(),
});

export const issueRoutes = {
  "/api/issues": {
    GET: h((req) => {
      const p = q(req);
      return json(listIssues({ projectId: p.get("project") ?? undefined, status: p.get("status") ?? undefined, q: p.get("q") ?? undefined, open: p.get("open") === "1", envKind: p.get("envKind") ?? undefined, limit: Number(p.get("limit") ?? 500) }));
    }),
    POST: h(async (req) => {
      const fd = await req.formData();
      const str = (k: string) => {
        const v = fd.get(k);
        return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
      };
      const title = str("title");
      const projectId = str("projectId");
      if (!title || title.length < 3) throw new HttpError(422, "validation", "A title is required (at least 3 characters)");
      const project = projectId ? getProject(projectId) : null;
      if (!project) throw new HttpError(422, "validation", "Select a project");
      const envId = str("environmentId");
      if (envId && getEnvironment(envId)?.project_id !== project.id) throw new HttpError(422, "validation", "The environment doesn't belong to this project");
      const priority = (str("priority") ?? "normal") as (typeof PRIORITIES)[number];
      if (!PRIORITIES.includes(priority)) throw new HttpError(422, "validation", "Invalid priority");
      const budget = str("budgetUsd") ? Number(str("budgetUsd")) : null;
      const issue = createIssue({ project_id: project.id, environment_id: envId ?? null, title, description: str("description") ?? "", reporter: str("reporter") ?? null, priority, budget_usd: budget !== null && Number.isFinite(budget) ? budget : null });
      await saveFiles(issue.id, fd.getAll("files").filter((f): f is File => f instanceof File), "upload");
      await saveFiles(issue.id, fd.getAll("pasted").filter((f): f is File => f instanceof File), "paste");
      const autoRun = str("autoRun") === undefined ? project.auto_run_agent : str("autoRun") === "true";
      enqueueJob("ingest", { issueId: issue.id, autoRun }, { priority: 7 });
      audit("user", "issue.create", { issueId: issue.id, environmentId: envId ?? null, detail: { key: issue.key } });
      emit({ type: "issue.updated", issueId: issue.id, patch: { created: true } });
      return json(getIssue(issue.id), 201);
    }),
  },
  "/api/issues/:id": {
    GET: h((req) => json(issueDetail(req.params.id!))),
    PATCH: h(async (req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      const { add_budget_usd, ...b } = await body(req, IssuePatch);
      const patch: Record<string, unknown> = { ...b };
      if (add_budget_usd) patch.budget_usd = effectiveBudget(i.id) + add_budget_usd;
      const u = updateIssue(i.id, patch);
      if (b.status === "resolved") enqueueJob("memory", { issueId: i.id }, { priority: 2 });
      emit({ type: "issue.updated", issueId: i.id, patch });
      return json(u);
    }),
    DELETE: h((req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      for (const j of cancelJobsFor("issueId", i.id)) dispatcher()?.cancel(j.id);
      deleteIssue(i.id);
      removeIssueDir(i.id);
      audit("user", "issue.delete", { detail: { key: i.key } });
      return json({ ok: true });
    }),
  },
  "/api/issues/:id/attachments": {
    POST: h(async (req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      const fd = await req.formData();
      const saved = [...(await saveFiles(i.id, fd.getAll("files").filter((f): f is File => f instanceof File), "upload")), ...(await saveFiles(i.id, fd.getAll("pasted").filter((f): f is File => f instanceof File), "paste"))];
      enqueueJob("ingest", { issueId: i.id, autoRun: false }, { priority: 7 });
      return json(saved.map((x) => ({ ...x.attachment, duplicate: x.duplicate })), 201);
    }),
  },
  "/api/attachments/:id/raw": {
    GET: h((req) => {
      const a = getAttachment(req.params.id!) ?? notFound("attachment");
      return fileResponse(req, dataPath(a.storage_path), "application/octet-stream", a.filename);
    }),
  },
  "/api/attachments/:id/thumb": {
    GET: h((req) => {
      const a = getAttachment(req.params.id!) ?? notFound("attachment");
      const t = (a.meta?.thumbnail as string | undefined) ?? (a.meta?.resized as string | undefined);
      if (!t) notFound("thumbnail");
      return fileResponse(req, dataPath(t!), "image/webp");
    }),
  },
  "/api/issues/:id/entities": {
    POST: h(async (req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      const b = await body(req, s.object({ type: s.string({ min: 2, max: 40 }), value: s.string({ min: 1, max: 500 }) }));
      return json(insertEntity({ issue_id: i.id, type: b.type, value: b.value, normalized: b.value, source_attachment_id: null, source_locator: "manual", confidence: 1, status: "manual" }), 201);
    }),
  },
  "/api/entities/:id": {
    PATCH: h(async (req) => {
      getEntity(req.params.id!) ?? notFound("entity");
      const b = await body(req, s.object({ status: s.enum(["auto", "confirmed", "rejected", "manual"] as const).optional(), value: s.string({ min: 1, max: 500 }).optional(), normalized: s.string({ max: 500 }).optional(), type: s.string({ max: 40 }).optional() }));
      return json(updateEntity(req.params.id!, b));
    }),
  },
  "/api/evidence/:id": {
    PATCH: h(async (req) => {
      const e = getEvidence(req.params.id!) ?? notFound("evidence");
      const b = await body(req, s.object({ status: s.enum(["proposed", "confirmed", "rejected"] as const).optional(), private: s.boolean().optional() }));
      const u = updateEvidence(e.id, b);
      const lvl = recomputeEvidenceLevel(e.issue_id);
      emit({ type: "evidence.updated", issueId: e.issue_id, evidence: u as unknown as Record<string, unknown> });
      emit({ type: "issue.updated", issueId: e.issue_id, patch: { evidence_level: lvl } });
      return json(u);
    }),
  },
  "/api/issues/:id/repro-scripts": {
    GET: h((req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      return json(listReproScripts(i.id));
    }),
    POST: h(async (req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      const raw = await req.json().catch(() => null);
      const v = validateDsl((raw as { dsl?: unknown } | null)?.dsl ?? raw);
      if (!v.ok) throw new HttpError(422, "dsl_invalid", v.error.message, v.error.details);
      const env = i.environment_id ? getEnvironment(i.environment_id) : null;
      const guard = env ? checkScript(v.value, guardModeFor(env.kind)) : { violations: [], skipped: [] };
      const rs = insertReproScript({ issue_id: i.id, environment_id: i.environment_id, dsl: v.value, author: "user" });
      return json({ ...rs, guard }, 201);
    }),
  },
  "/api/issues/:id/runs": {
    POST: h(async (req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      const b = await body(req, s.object({ mode: s.enum(["explore", "reproduce", "capture", "verify_before", "verify_after"] as const), reproScriptId: s.string().optional(), recordVideo: s.boolean().optional() }));
      if (!i.environment_id) throw new HttpError(409, "no_env", "The issue has no environment yet");
      const rsId = b.reproScriptId ?? listReproScripts(i.id)[0]?.id;
      if (!rsId || getReproScript(rsId)?.issue_id !== i.id) throw new HttpError(409, "no_script", "No repro script yet");
      if (b.mode === "capture" && i.evidence_level < 3) throw new HttpError(409, "evidence_too_low", `Final capture requires at least E3 (currently E${i.evidence_level})`);
      const job = enqueueJob("browser_run", { issueId: i.id, environmentId: i.environment_id, reproScriptId: rsId, mode: b.mode, recordVideo: b.recordVideo ?? (b.mode === "capture" || b.mode.startsWith("verify")) }, { priority: 7, maxAttempts: 1 });
      return json(job, 202);
    }),
  },
  "/api/runs/:id": {
    GET: h((req) => {
      const r = getRun(req.params.id!) ?? notFound("run");
      return json({ ...r, artifacts: listRunArtifacts(r.id) });
    }),
  },
  "/api/issues/:id/artifacts": {
    GET: h((req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      return json(listArtifacts(i.id, q(req).get("kind") ?? undefined));
    }),
  },
  "/api/artifacts/:id/file": {
    GET: h((req) => {
      const a = getArtifact(req.params.id!) ?? notFound("artifact");
      const dl = q(req).get("download") === "1" ? a.storage_path.split("/").pop() : undefined;
      return fileResponse(req, dataPath(a.storage_path), a.mime, dl);
    }),
  },
};
