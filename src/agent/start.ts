// Start / resume an agent session: one active session per issue.
import { activeSession, createSession, getSession, updateSession, type SessionTrigger } from "../db/repo/sessions.ts";
import { getIssue } from "../db/repo/issues.ts";
import { latestAccessProfile } from "../db/repo/environments.ts";
import { enqueueJob } from "../jobs/enqueue.ts";
import { modelFor } from "../llm/models.ts";
import type { AgentState } from "./types.ts";

export function startAgentSession(issueId: string, trigger: SessionTrigger, opts: { state?: AgentState; directive?: string } = {}) {
  const issue = getIssue(issueId);
  if (!issue) throw new Error("issue not found");
  const active = activeSession(issueId);
  if (active && active.status === "running") return { session: active, resumed: false, alreadyRunning: true };
  if (active && (active.status === "awaiting_user" || active.status === "budget_exceeded")) {
    updateSession(active.id, { status: "running", state: opts.state ?? (active.state === "AWAIT_USER" || active.state === "BLOCKED" || active.state === "BUDGET_EXCEEDED" ? "INVESTIGATE" : active.state), error: null });
    enqueueJob("agent_session", { issueId, sessionId: active.id, ...(opts.directive && { directive: opts.directive }) }, { priority: 6, maxAttempts: 2 });
    return { session: getSession(active.id)!, resumed: true, alreadyRunning: false };
  }
  const profile = issue.environment_id ? latestAccessProfile(issue.environment_id) : null;
  const s = createSession({ issue_id: issueId, trigger, state: opts.state ?? (issue.triage ? "INVESTIGATE" : "TRIAGE"), model_main: modelFor("agent_main"), access_profile_id: profile?.id ?? null });
  enqueueJob("agent_session", { issueId, sessionId: s.id, ...(opts.directive && { directive: opts.directive }) }, { priority: 5, maxAttempts: 2 });
  return { session: s, resumed: false, alreadyRunning: false };
}
