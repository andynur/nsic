// Job browser_run: capture / reproduce / verify_before / verify_after (08 §4, §8).
import type { JobHandler } from "../handlers.ts";
import { getReproScript, insertRun, finishRun, listRuns, type RunMode } from "../../db/repo/artifacts.ts";
import { getEnvironment } from "../../db/repo/environments.ts";
import { getIssue, recomputeEvidenceLevel, updateIssue } from "../../db/repo/issues.ts";
import { insertEvidence, listEvidence } from "../../db/repo/evidence.ts";
import { addMessage } from "../../db/repo/threads.ts";
import { getSetting } from "../../db/repo/settings.ts";
import { emit } from "../../realtime/events.ts";
import { validateDsl } from "../../browser/dsl.ts";
import { withSession } from "../../browser/session.ts";
import { runRepro, type RunResult } from "../../browser/runner.ts";

const note = (issueId: string, content: string) => {
  const m = addMessage(issueId, "agent", { role: "system_event", content });
  emit({ type: "message.added", issueId, thread: "agent", message: m as unknown as Record<string, unknown> });
};

/** The symptom is visible when an expectError step passes or a NetSuite error appears. */
export const symptomSeen = (r: RunResult) => r.steps.some((s) => s.action === "expectError" && s.status === "passed") || r.errorsSeen.length > 0;

const handler: JobHandler = async (job, signal) => {
  const p = job.payload as { issueId: string; environmentId: string; reproScriptId: string; mode: RunMode; recordVideo?: boolean };
  const issue = getIssue(p.issueId);
  const env = getEnvironment(p.environmentId);
  const rs = getReproScript(p.reproScriptId);
  if (!issue || !env || !rs) throw new Error("issue/environment/repro script not found");
  const v = validateDsl(rs.dsl);
  if (!v.ok) throw new Error(`Invalid repro DSL: ${v.error.message}`);
  const run = insertRun({ issue_id: issue.id, repro_script_id: rs.id, mode: p.mode, environment_id: env.id, record_video: !!p.recordVideo });
  note(issue.id, `Browser run ${p.mode} started (repro v${rs.version}).`);
  const projectRedact = getSetting<{ selectors?: string[]; patterns?: string[] }>(`redact.project.${issue.project_id}`, {});
  const vp = v.value.viewport ?? { width: 1440, height: 900 };
  const r = await withSession(env.id, (driver, e) => runRepro(v.value, { driver, env: e, issueId: issue.id, runId: run.id, mode: p.mode, record: !!p.recordVideo, projectRedact, signal }), vp);
  if (!r.ok) {
    finishRun(run.id, "failed", { error: r.error.message });
    emit({ type: "run.done", issueId: issue.id, runId: run.id, status: "failed" });
    note(issue.id, `Browser run failed: ${r.error.message}`);
    throw new Error(r.error.message);
  }
  const res = r.value;
  finishRun(run.id, res.status, res as unknown as Record<string, unknown>);
  emit({ type: "run.done", issueId: issue.id, runId: run.id, status: res.status });

  const seen = symptomSeen(res);
  if (p.mode === "capture" || p.mode === "reproduce" || p.mode === "verify_before") {
    if (seen && !listEvidence(issue.id).some((e) => e.level === 3 && (e.ref as { run_id?: string } | null)?.run_id === run.id)) {
      insertEvidence({ issue_id: issue.id, level: 3, kind: "repro_run", title: `Symptom appears when replaying (${p.mode})`, body: `Errors seen: ${[...new Set(res.errorsSeen)].slice(0, 5).join(" | ") || "expectError matched"}`, ref: { run_id: run.id, ...(res.video?.artifactId && { artifact_id: res.video.artifactId }) } });
    }
  }
  if (p.mode === "verify_after") {
    const before = listRuns(issue.id).find((x) => x.mode === "verify_before" || x.mode === "capture" || x.mode === "reproduce");
    if (!seen && res.status !== "blocked" && !res.loginRequired) {
      insertEvidence({ issue_id: issue.id, level: 5, kind: "repro_run", title: "Replay after the fix: the symptom no longer appears", body: `The verify_after replay in ${env.name} ran ${res.steps.length} steps without errors.${before ? ` Compared with: run ${before.mode}.` : ""}`, ref: { run_id: run.id, before_run_id: before?.id ?? null } });
      note(issue.id, "Verification passed: the symptom no longer appears after the fix (E5).");
    } else note(issue.id, `Verification not passed yet: ${seen ? "the symptom still appears" : res.status}.`);
  }
  const lvl = recomputeEvidenceLevel(issue.id);
  if (lvl >= 3 && issue.status === "investigating") updateIssue(issue.id, { status: "reproduced" });
  emit({ type: "issue.updated", issueId: issue.id, patch: { evidence_level: lvl } });
  const blocked = res.blocked.length ? ` ${res.blocked.length} actions blocked by the guard.` : "";
  note(issue.id, `Browser run ${p.mode} finished: ${res.status}.${blocked}${res.video?.reason ? ` Video: ${res.video.reason}` : res.video?.artifactId ? " Video saved." : ""}${res.loginRequired ? " Log in again (Login Assist)." : ""}`);
  return { runId: run.id, status: res.status };
};
export default handler;
