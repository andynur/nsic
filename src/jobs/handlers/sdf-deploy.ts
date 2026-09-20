// sdf_deploy_sandbox job: only after approval (05 §3, 07 §5). Guard: registry + sdf.ts (two places).
import type { JobHandler } from "../handlers.ts";
import { getIssue } from "../../db/repo/issues.ts";
import { getEnvironment, latestAccessProfile } from "../../db/repo/environments.ts";
import { getSession, startStep, finishStep, updateSession } from "../../db/repo/sessions.ts";
import { getRepo, listRepos } from "../../db/repo/code.ts";
import { insertEvidence } from "../../db/repo/evidence.ts";
import { getCredentialRow } from "../../db/repo/credentials.ts";
import { loadSecret } from "../../netsuite/credentials.ts";
import { executeTool } from "../../agent/tools/execute.ts";
import { repoDir } from "../../repo/indexer.ts";
import { $ } from "bun";
import { enqueue } from "../../db/repo/jobs.ts";

const handler: JobHandler = async (job, signal) => {
  const p = job.payload as { issueId: string; sessionId: string };
  const issue = getIssue(p.issueId);
  const session = getSession(p.sessionId);
  if (!issue || !session || !issue.environment_id) throw new Error("issue/session/environment incomplete");
  const env = getEnvironment(issue.environment_id);
  if (!env || env.kind !== "sandbox") throw new Error("Deploy is only allowed to sandbox");
  const repo = listRepos(issue.project_id).map((r) => getRepo(r.id)).find(Boolean);
  if (!repo) throw new Error("no repo");
  if (!getCredentialRow(env.id, "sdf_auth_id")) throw new Error("No SuiteCloud authId saved for this environment");
  const auth = await loadSecret<{ authId: string }>(env.id, "sdf_auth_id", "sdf.deploy");
  if (!auth.ok) throw new Error(auth.error.message);
  const dir = repoDir(repo);
  const base = repo.default_branch ?? "main";
  const diff = await $`git diff --name-only ${base}...HEAD`.cwd(dir).nothrow().quiet();
  const paths = diff.stdout.toString().split("\n").filter((l) => /FileCabinet\/|Objects\//.test(l));
  const step = startStep({ session_id: session.id, state: "DEPLOY_SANDBOX", kind: "tool", title: "Deploy sandbox" });
  const r = await executeTool("sdf_deploy_sandbox", { paths, auth_id: auth.value.authId }, { issue, session, env, profile: latestAccessProfile(env.id), tier: latestAccessProfile(env.id)?.tier ?? "none", state: "DEPLOY_SANDBOX", stepId: step.id, repoIds: [repo.id], signal }, { approved: true });
  finishStep(step.id, { status: r.ok ? "done" : "failed", summary: r.ok ? r.value.content.slice(0, 400) : r.error.message });
  if (!r.ok) {
    updateSession(session.id, { state: "AWAIT_USER", status: "awaiting_user", error: r.error.message });
    throw new Error(r.error.message);
  }
  insertEvidence({ issue_id: issue.id, session_id: session.id, level: 4, kind: "deploy_result", title: `Sandbox deploy: ${paths.length} ${paths.length === 1 ? "file/object" : "files/objects"}`, body: paths.join("\n"), ref: { paths }, private: true });
  updateSession(session.id, { state: "VERIFY", status: "running" });
  enqueue("agent_session", { issueId: issue.id, sessionId: session.id }, { priority: 6 });
  return { deployed: paths.length };
};
export default handler;
