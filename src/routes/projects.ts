// /api/projects, /api/environments, /api/repos (13 §1).
import { s } from "../lib/schema.ts";
import { now } from "../lib/ids.ts";
import { body, h, json, notFound, fromAppError, q, HttpError } from "./http.ts";
import { createProject, getProject, listProjects, updateProject } from "../db/repo/projects.ts";
import { accessProfileHistory, createEnvironment, deleteEnvironment, getEnvironment, latestAccessProfile, listEnvironments, updateEnvironment } from "../db/repo/environments.ts";
import { listCredentialMeta } from "../db/repo/credentials.ts";
import { createRepo, deleteRepo, getRepo, listRepos, repoStats, searchCode } from "../db/repo/code.ts";
import { audit } from "../db/repo/audit.ts";
import { enqueueJob } from "../jobs/enqueue.ts";
import { recordAutomation } from "../repo/graph.ts";
import { startOAuth } from "../netsuite/oauth-pkce.ts";
import { createKeypair, saveM2mIds } from "../netsuite/m2m-jwt.ts";
import { saveSecret } from "../netsuite/credentials.ts";
import { CAPABILITY_HINTS } from "../netsuite/probe.ts";
import { openSetupTerminal } from "../netsuite/terminal.ts";
import { startLoginAssist, finishLoginAssist } from "../browser/session.ts";
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

const ProjectIn = s.object({
  name: s.string({ min: 1, max: 120 }),
  client_name: s.string({ max: 120 }).nullable().optional(),
  key_prefix: s.string({ min: 1, max: 10, pattern: /^[A-Za-z0-9]+$/ }).optional(),
  auto_run_agent: s.boolean().optional(),
  default_budget_usd: s.number({ min: 0, max: 1000 }).optional(),
  notes: s.string({ max: 4000 }).nullable().optional(),
});
const ProjectPatch = s.object({ name: s.string({ min: 1, max: 120 }).optional(), client_name: s.string({ max: 120 }).nullable().optional(), key_prefix: s.string({ min: 1, max: 10, pattern: /^[A-Za-z0-9]+$/ }).optional(), auto_run_agent: s.boolean().optional(), default_budget_usd: s.number({ min: 0, max: 1000 }).optional(), notes: s.string({ max: 4000 }).nullable().optional(), archived: s.boolean().optional() });

const ENV_KINDS = ["sandbox", "production", "release_preview", "dev"] as const;
const EnvIn = s.object({
  name: s.string({ min: 1, max: 60 }),
  kind: s.enum(ENV_KINDS),
  account_id: s.string({ min: 3, max: 40, pattern: /^[A-Za-z0-9_-]+$/ }),
  timezone: s.string({ max: 60 }).nullable().optional(),
  ui_base_url: s.string({ max: 300, pattern: /^https:\/\/[\w.-]+\.netsuite\.com\/?$/ }).nullable().optional(),
  mcp_url: s.string({ max: 400, pattern: /^https:\/\/[\w.-]+\.netsuite\.com\// }).nullable().optional(),
});
const EnvPatch = s.object({
  name: s.string({ min: 1, max: 60 }).optional(),
  timezone: s.string({ max: 60 }).nullable().optional(),
  ui_base_url: s.string({ max: 300, pattern: /^https:\/\/[\w.-]+\.netsuite\.com\/?$/ }).nullable().optional(),
  mcp_url: s.string({ max: 400, pattern: /^https:\/\/[\w.-]+\.netsuite\.com\// }).nullable().optional(),
  automation_consent: s.object({ given: s.boolean(), by: s.string({ max: 120 }).optional() }).optional(),
  monitor_enabled: s.boolean().optional(),
});

function envView(id: string) {
  const env = getEnvironment(id) ?? notFound("environment");
  const profile = latestAccessProfile(id);
  const caps = profile?.capabilities ?? {};
  return {
    ...env,
    profile,
    credentials: listCredentialMeta(id),
    capabilityTable: Object.entries(CAPABILITY_HINTS).map(([name, hint]) => ({ name, available: !!caps[name], hint })),
  };
}

export const projectRoutes = {
  "/api/projects": {
    GET: h((req) => {
      const all = q(req).get("archived") === "1";
      return json(listProjects(all).map((p) => ({ ...p, environments: listEnvironments(p.id).map((e) => ({ ...e, tier: latestAccessProfile(e.id)?.tier ?? "none" })), repos: listRepos(p.id) })));
    }),
    POST: h(async (req) => {
      const p = createProject(await body(req, ProjectIn));
      audit("user", "project.create", { detail: { id: p.id, name: p.name } });
      return json(p, 201);
    }),
  },
  "/api/projects/:id": {
    GET: h((req) => {
      const p = getProject(req.params.id!) ?? notFound("project");
      return json({ ...p, environments: listEnvironments(p.id).map((e) => envView(e.id)), repos: listRepos(p.id).map((r) => ({ ...r, stats: repoStats(r.id) })) });
    }),
    PATCH: h(async (req) => {
      const b = await body(req, ProjectPatch);
      const { archived, ...rest } = b;
      const p = updateProject(req.params.id!, { ...rest, ...(archived !== undefined && { archived_at: archived ? now() : null }) }) ?? notFound("project");
      return json(p);
    }),
    DELETE: h((req) => {
      const p = updateProject(req.params.id!, { archived_at: now() }) ?? notFound("project");
      return json(p);
    }),
  },
  "/api/projects/:id/environments": {
    POST: h(async (req) => {
      getProject(req.params.id!) ?? notFound("project");
      const b = await body(req, EnvIn);
      const e = createEnvironment({ ...b, project_id: req.params.id!, ui_base_url: b.ui_base_url?.replace(/\/$/, "") });
      audit("user", "environment.create", { environmentId: e.id, detail: { kind: e.kind, account: e.account_id } });
      return json(envView(e.id), 201);
    }),
  },
  "/api/environments/:id": {
    GET: h((req) => json(envView(req.params.id!))),
    PATCH: h(async (req) => {
      const b = await body(req, EnvPatch);
      const { automation_consent, ...rest } = b;
      getEnvironment(req.params.id!) ?? notFound("environment");
      updateEnvironment(req.params.id!, { ...rest, ...(rest.ui_base_url && { ui_base_url: rest.ui_base_url.replace(/\/$/, "") }), ...(automation_consent && { automation_consent_at: automation_consent.given ? now() : null }) });
      if (automation_consent) audit("user", "environment.consent", { environmentId: req.params.id!, detail: automation_consent });
      return json(envView(req.params.id!));
    }),
    DELETE: h((req) => {
      getEnvironment(req.params.id!) ?? notFound("environment");
      deleteEnvironment(req.params.id!);
      audit("user", "environment.delete", { environmentId: req.params.id! });
      return json({ ok: true });
    }),
  },
  "/api/environments/:id/probe": {
    POST: h((req) => {
      getEnvironment(req.params.id!) ?? notFound("environment");
      return json(enqueueJob("probe_env", { environmentId: req.params.id! }, { priority: 8, maxAttempts: 1 }), 202);
    }),
  },
  "/api/environments/:id/access-profile": {
    GET: h((req) => json({ latest: latestAccessProfile(req.params.id!), history: accessProfileHistory(req.params.id!) })),
  },
  "/api/environments/:id/oauth/start": {
    POST: h(async (req) => {
      const b = await body(req, s.object({ clientId: s.string({ min: 8, max: 200 }), scope: s.string({ max: 200 }).optional() }));
      const env = getEnvironment(req.params.id!) ?? notFound("environment");
      if (!env.automation_consent_at) throw new HttpError(409, "consent_required", "Record the client's automation consent first (wizard step 2)");
      const r = await startOAuth(env.id, b.clientId, b.scope);
      if (!r.ok) fromAppError(r.error);
      return json(r.value);
    }),
  },
  "/api/environments/:id/m2m/keypair": {
    POST: h(async (req) => {
      const r = await createKeypair(req.params.id!);
      if (!r.ok) fromAppError(r.error);
      return json(r.value);
    }),
  },
  "/api/environments/:id/m2m": {
    PUT: h(async (req) => {
      const b = await body(req, s.object({ clientId: s.string({ min: 8, max: 200 }), certificateId: s.string({ min: 4, max: 200 }) }));
      const r = await saveM2mIds(req.params.id!, b.clientId, b.certificateId);
      if (!r.ok) fromAppError(r.error);
      return json({ ok: true });
    }),
  },
  "/api/environments/:id/sdf": {
    PUT: h(async (req) => {
      const b = await body(req, s.object({ authId: s.string({ min: 1, max: 100, pattern: /^[\w.-]+$/ }) }));
      const r = await saveSecret(req.params.id!, "sdf_auth_id", { authId: b.authId });
      if (!r.ok) fromAppError(r.error);
      return json({ ok: true });
    }),
  },
  "/api/environments/:id/login-assist/start": {
    POST: h((req) => {
      const r = startLoginAssist(req.params.id!);
      if (!r.ok) fromAppError(r.error, 409);
      return json(r.value);
    }),
  },
  "/api/environments/:id/login-assist/finish": {
    POST: h(async (req) => {
      const r = await finishLoginAssist(req.params.id!);
      if (!r.ok) fromAppError(r.error, 409);
      return json(r.value);
    }),
  },
  "/api/environments/:id/terminal": {
    POST: h((req) => {
      const env = getEnvironment(req.params.id!) ?? notFound("environment");
      const repo = listRepos(env.project_id).find((r) => r.source === "local_path");
      const r = openSetupTerminal(env.id, repo?.location);
      if (!r.ok) fromAppError(r.error, 409);
      return json(r.value);
    }),
  },
  "/api/projects/:id/repos": {
    POST: h(async (req) => {
      getProject(req.params.id!) ?? notFound("project");
      const b = await body(req, s.object({ source: s.enum(["local_path", "git_url"] as const), location: s.string({ min: 2, max: 1000 }), default_branch: s.string({ max: 100 }).optional() }));
      if (b.source === "local_path" && (!isAbsolute(b.location) || !existsSync(b.location) || !statSync(b.location).isDirectory())) throw new HttpError(422, "bad_path", "The local path must be absolute and an existing folder");
      if (b.source === "git_url" && !/^(https:\/\/|git@|ssh:\/\/)/.test(b.location)) throw new HttpError(422, "bad_url", "The git URL must start with https://, ssh://, or git@");
      const r = createRepo({ project_id: req.params.id!, ...b });
      enqueueJob("index_repo", { repoId: r.id }, { priority: 6, maxAttempts: 1 });
      return json(r, 201);
    }),
  },
  "/api/repos/:id": {
    DELETE: h((req) => {
      getRepo(req.params.id!) ?? notFound("repo");
      deleteRepo(req.params.id!);
      return json({ ok: true });
    }),
  },
  "/api/repos/:id/index": {
    POST: h((req) => {
      getRepo(req.params.id!) ?? notFound("repo");
      return json(enqueueJob("index_repo", { repoId: req.params.id! }, { priority: 6, maxAttempts: 1 }), 202);
    }),
  },
  "/api/repos/:id/graph": {
    GET: h((req) => {
      const rec = q(req).get("record");
      if (!rec) throw new HttpError(422, "validation", "the record parameter is required");
      return json(recordAutomation([req.params.id!], rec));
    }),
  },
  "/api/repos/:id/search": {
    GET: h((req) => json(searchCode([req.params.id!], q(req).get("q") ?? "", 30))),
  },
};
