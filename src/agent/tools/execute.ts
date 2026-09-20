// Tool execution with guard registry: env/tier/capability/state → audit → tool_calls → event.
import { type Result, ok, appErr, errorMessage } from "../../lib/result.ts";
import { issueDir, writeData, relData } from "../../lib/fs.ts";
import { redactSecrets } from "../../lib/redact-secrets.ts";
import { audit } from "../../db/repo/audit.ts";
import { finishToolCall, insertToolCall } from "../../db/repo/sessions.ts";
import { emit } from "../../realtime/events.ts";
import type { ToolCtx, ToolOutput } from "../types.ts";
import { allowedInState, toolAvailability } from "./registry.ts";
import { toolByName } from "./defs.ts";

export const PREVIEW_CHARS = 8000;

export async function executeTool(name: string, input: unknown, ctx: Omit<ToolCtx, "toolCallId">, opts: { approved?: boolean } = {}): Promise<Result<ToolOutput> & { toolCallId: string }> {
  const t = toolByName(name);
  const risk = t?.risk ?? "blocked";
  const tc = insertToolCall({ step_id: ctx.stepId, tool: name, risk, input });
  const started = performance.now();
  const base = { issueId: ctx.issue.id, sessionId: ctx.session.id, stepId: ctx.stepId };
  emit({ type: "tool.call", ...base, tool: name, risk, inputPreview: JSON.stringify(input).slice(0, 400) });

  const fail = (code: string, message: string, blocked = false) => {
    finishToolCall(tc.id, { ok: false, output_preview: message, duration_ms: Math.round(performance.now() - started) });
    if (blocked) audit("agent", "tool.blocked", { environmentId: ctx.env?.id, issueId: ctx.issue.id, detail: { tool: name, reason: message } });
    emit({ type: "tool.result", ...base, ok: false, outputPreview: message, durationMs: Math.round(performance.now() - started) });
    return { ...appErr(code, message), toolCallId: tc.id };
  };

  if (!t) return fail("unknown_tool", `Tool ${name} is unknown`, true);
  const av = toolAvailability(t, ctx.env, ctx.profile ?? { capabilities: {}, tier: "none" }, ctx.repoIds.length > 0);
  if (!av.available) return fail("tool_blocked", `Tool ${name} is not available: ${av.reason}`, true);
  if (!allowedInState(t, ctx.state)) return fail("tool_state", `Tool ${name} cannot be used in state ${ctx.state}`, true);
  if (t.needsApproval && !opts.approved) return fail("needs_approval", `Tool ${name} requires user approval`, true);
  const parsed = t.parse(input);
  if (!parsed.ok) return fail("invalid_input", `Invalid input: ${(parsed.error as { message?: string }).message ?? JSON.stringify(parsed.error)}`);

  audit("agent", "tool.call", { environmentId: ctx.env?.id, issueId: ctx.issue.id, detail: { tool: name, risk, input: JSON.parse(redactSecrets(JSON.stringify(input))).query ? { query: (input as { query: string }).query.slice(0, 500) } : undefined } });
  try {
    const r = await t.run(parsed.value, { ...ctx, toolCallId: tc.id });
    if (!r.ok) return fail(r.error.code, r.error.message);
    let content = redactSecrets(r.value.content);
    let outputPath: string | null = null;
    if (content.length > PREVIEW_CHARS || r.value.data !== undefined) {
      outputPath = relData(await writeData(issueDir(ctx.issue.id, "tool-outputs", `${tc.id}.json`), redactSecrets(JSON.stringify({ content: r.value.content, data: r.value.data }, null, 1))));
      if (content.length > PREVIEW_CHARS) content = `${content.slice(0, PREVIEW_CHARS)}\n… [full output saved, ${content.length} characters]`;
    }
    const dur = Math.round(performance.now() - started);
    finishToolCall(tc.id, { ok: true, output_preview: content.slice(0, 2000), output_path: outputPath, duration_ms: dur, approved_by_user: !!opts.approved });
    emit({ type: "tool.result", ...base, ok: true, outputPreview: content.slice(0, 600), durationMs: dur });
    return { ...ok({ ...r.value, content }), toolCallId: tc.id };
  } catch (e) {
    return fail("tool_exception", `Tool ${name} error: ${errorMessage(e)}`);
  }
}
