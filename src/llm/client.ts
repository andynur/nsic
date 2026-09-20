// Single entry point for LLM calls: budget check → transport → record usage.
import { type Result, appErr } from "../lib/result.ts";
import { redactSecrets } from "../lib/redact-secrets.ts";
import { getTransport, type StreamHandlers } from "./anthropic.ts";
import type { MessagesRequest, MessagesResponse } from "./types.ts";
import { checkBudget, estimateTokens, recordUsage, type UsageCtx } from "./usage.ts";

export class BudgetExceededError extends Error {
  constructor(public readonly info: { budget: number; spent: number; estimate: number }) {
    super(`Issue budget exhausted: spent $${info.spent.toFixed(4)} of $${info.budget.toFixed(2)}`);
  }
}

export async function callLlm(req: MessagesRequest, ctx: UsageCtx, h: StreamHandlers = {}): Promise<Result<MessagesResponse>> {
  // Last layer: secrets are never sent to the LLM (NFR-05).
  const body = JSON.parse(redactSecrets(JSON.stringify(req))) as MessagesRequest;
  if (ctx.issueId) {
    const est = estimateTokens(JSON.stringify(body.system ?? "") + JSON.stringify(body.messages) + JSON.stringify(body.tools ?? []));
    const b = checkBudget(ctx.issueId, body.model, est, body.max_tokens);
    if (!b.ok) return appErr("budget_exceeded", `Issue budget insufficient ($${b.remaining.toFixed(4)} remaining, estimated $${b.estimate.toFixed(4)})`, b);
  }
  const r = await getTransport()(body, h);
  if (!r.ok) return r;
  const { response, requestId, latencyMs } = r.value;
  recordUsage(ctx, response.model || body.model, response.usage, { latencyMs, stopReason: response.stop_reason, requestId });
  if (response.stop_reason === "refusal") return appErr("llm_refusal", "The model declined this request (stop_reason=refusal)");
  return r.value.response ? { ok: true, value: response } : appErr("llm_empty", "empty response");
}

/** Call the model with one structured tool and return that tool's input (05 §8). */
export async function callStructured<T>(
  req: Omit<MessagesRequest, "tools" | "tool_choice"> & { tool: { name: string; description: string; input_schema: Record<string, unknown> } },
  ctx: UsageCtx,
  parse: (v: unknown) => Result<T, unknown>,
): Promise<Result<T>> {
  const { tool, ...rest } = req;
  const r = await callLlm({ ...rest, tools: [tool], tool_choice: { type: "tool", name: tool.name } }, ctx);
  if (!r.ok) return r;
  const use = r.value.content.find((b) => b.type === "tool_use" && b.name === tool.name);
  if (!use || use.type !== "tool_use") return appErr("llm_no_tool", `The model did not call ${tool.name}`);
  const p = parse(use.input);
  if (!p.ok) return appErr("llm_invalid_output", `Invalid ${tool.name} output`, p.error);
  return p as Result<T>;
}
