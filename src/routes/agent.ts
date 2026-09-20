// /api/sessions, approvals, threads, consultant (13 §1).
import { s } from "../lib/schema.ts";
import { body, h, json, notFound, fromAppError, q, HttpError } from "./http.ts";
import { getIssueByKeyOrId } from "../db/repo/issues.ts";
import { getSession, getStep, getToolCall, listSteps, listToolCallsForSession, updateSession } from "../db/repo/sessions.ts";
import { stepUsageForSession, sessionTotals } from "../db/repo/usage.ts";
import { addMessage, listMessages } from "../db/repo/threads.ts";
import { cancelJobsFor } from "../db/repo/jobs.ts";
import { audit } from "../db/repo/audit.ts";
import { db } from "../db/db.ts";
import { dispatcher } from "../jobs/dispatcher.ts";
import { enqueueJob } from "../jobs/enqueue.ts";
import { startAgentSession } from "../agent/start.ts";
import { postAgentMessage } from "../agent/chat.ts";
import { AGENT_STATES } from "../agent/types.ts";
import { draftConsultantAnswer, markFaq } from "../consultant/assistant.ts";
import { emit } from "../realtime/events.ts";
import { safeMarkdown } from "../reports/html.ts";

export const agentRoutes = {
  "/api/issues/:id/sessions": {
    POST: h(async (req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      const b = await body(req, s.object({ trigger: s.enum(["auto", "chat", "capture", "verify", "fix", "manual"] as const).optional(), state: s.enum(AGENT_STATES).optional(), directive: s.string({ max: 2000 }).optional() }));
      if (b.state === "CAPTURE" && i.evidence_level < 3) throw new HttpError(409, "evidence_too_low", `Final capture requires at least E3 (currently E${i.evidence_level})`);
      return json(startAgentSession(i.id, b.trigger ?? "manual", { ...(b.state && { state: b.state }), ...(b.directive && { directive: b.directive }) }), 202);
    }),
  },
  "/api/sessions/:id/cancel": {
    POST: h((req) => {
      const sess = getSession(req.params.id!) ?? notFound("session");
      for (const j of cancelJobsFor("sessionId", sess.id)) dispatcher()?.cancel(j.id);
      updateSession(sess.id, { status: "cancelled" });
      emit({ type: "session.ended", sessionId: sess.id, issueId: sess.issue_id, status: "cancelled" });
      audit("user", "session.cancel", { issueId: sess.issue_id });
      return json(getSession(sess.id));
    }),
  },
  "/api/sessions/:id/resume": {
    POST: h((req) => {
      const sess = getSession(req.params.id!) ?? notFound("session");
      return json(startAgentSession(sess.issue_id, "manual"), 202);
    }),
  },
  "/api/sessions/:id/steps": {
    GET: h((req) => {
      const sess = getSession(req.params.id!) ?? notFound("session");
      const after = Number(q(req).get("after") ?? 0);
      const usage = new Map(stepUsageForSession(sess.id).map((u) => [u.step_id, u]));
      const calls = listToolCallsForSession(sess.id);
      return json({ session: sess, totals: sessionTotals(sess.id), steps: listSteps(sess.id, after).map((st) => ({ ...st, usage: usage.get(st.id) ?? null, toolCalls: calls.filter((c) => c.step_id === st.id) })) });
    }),
  },
  "/api/approvals/:toolCallId": {
    POST: h(async (req) => {
      const tc = getToolCall(req.params.toolCallId!) ?? notFound("tool call");
      const b = await body(req, s.object({ approve: s.boolean(), note: s.string({ max: 1000 }).optional() }));
      const step = getStep(tc.step_id)!;
      const sess = getSession(step.session_id)!;
      if (tc.tool !== "sdf_deploy_sandbox" || sess.state !== "AWAIT_DEPLOY_APPROVAL") throw new HttpError(409, "no_pending_approval", "There is no approval waiting");
      db().query("UPDATE tool_calls SET approved_by_user = ?, output_preview = ? WHERE id = ?").run(b.approve ? 1 : 0, b.approve ? "approved" : `rejected: ${b.note ?? ""}`, tc.id);
      audit("user", b.approve ? "deploy.approve" : "deploy.reject", { issueId: sess.issue_id, detail: { toolCallId: tc.id, note: b.note } });
      addMessage(sess.issue_id, "agent", { role: "user", content: b.approve ? "Approve deploy to sandbox." : `Reject deploy. ${b.note ?? ""}` });
      if (b.approve) {
        updateSession(sess.id, { state: "DEPLOY_SANDBOX", status: "running" });
        enqueueJob("sdf_deploy_sandbox", { issueId: sess.issue_id, sessionId: sess.id }, { priority: 8, maxAttempts: 1 });
      } else updateSession(sess.id, { state: "AWAIT_USER", status: "awaiting_user" });
      return json({ ok: true });
    }),
  },
  "/api/issues/:id/threads/:kind/messages": {
    GET: h((req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      const kind = req.params.kind === "consultant" ? "consultant" : "agent";
      return json(listMessages(i.id, kind).map((m) => ({ ...m, html: safeMarkdown(m.content) })));
    }),
    POST: h(async (req) => {
      if (req.params.kind !== "agent") throw new HttpError(405, "method", "Use /threads/consultant/draft for the consultant thread");
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      const b = await body(req, s.object({ content: s.string({ min: 1, max: 20_000 }) }));
      const r = await postAgentMessage(i.id, b.content);
      if (!r.ok) fromAppError(r.error);
      return json(r.value, 201);
    }),
  },
  "/api/issues/:id/threads/consultant/draft": {
    POST: h(async (req) => {
      const i = getIssueByKeyOrId(req.params.id!) ?? notFound("issue");
      const b = await body(
        req,
        s.object({
          question: s.string({ min: 2, max: 8000 }),
          language: s.enum(["id", "en", "auto"] as const).optional(),
          tone: s.enum(["formal", "casual"] as const).optional(),
          length: s.enum(["short", "paragraph", "bullets"] as const).optional(),
          audience: s.enum(["functional", "client", "technical"] as const).optional(),
          eta: s.string({ max: 200 }).optional(),
          modifier: s.enum(["shorter", "more_formal", "translate"] as const).optional(),
          previousDraftId: s.string().optional(),
        }),
      );
      const r = await draftConsultantAnswer(i.id, { question: b.question, language: b.language ?? "auto", tone: b.tone ?? "casual", length: b.length ?? "short", audience: b.audience ?? "functional", ...(b.eta && { eta: b.eta }), ...(b.modifier && { modifier: b.modifier }), ...(b.previousDraftId && { previousDraftId: b.previousDraftId }) });
      if (!r.ok) fromAppError(r.error, r.error.code === "llm_no_key" ? 409 : 400);
      return json(r.value, 201);
    }),
  },
  "/api/messages/:id/faq": {
    POST: h(async (req) => {
      const b = await body(req, s.object({ faq: s.boolean() }));
      return json(markFaq(req.params.id!, b.faq) ?? notFound("message"));
    }),
  },
};
