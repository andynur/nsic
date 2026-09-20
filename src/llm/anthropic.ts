// Messages API client using fetch + an in-house SSE parser (03 §2, no SDK: dependency budget ADR-001).
import { config } from "../config.ts";
import { type Result, ok, appErr, errorMessage } from "../lib/result.ts";
import { cliBinary, cliTransport } from "./cli.ts";
import { llmEngine } from "./models.ts";
import { parseSse } from "./sse.ts";
import type { ContentBlock, MessagesRequest, MessagesResponse, Usage } from "./types.ts";

export type StreamHandlers = { onText?: (delta: string) => void };
export type LlmTransport = (req: MessagesRequest, h: StreamHandlers) => Promise<Result<{ response: MessagesResponse; requestId: string | null; latencyMs: number }>>;

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/** Default transport: HTTP streaming to /v1/messages with exponential retry. */
export const httpTransport: LlmTransport = async (req, h) => {
  const cfg = config();
  if (!cfg.anthropicApiKey) return appErr("llm_no_key", "ANTHROPIC_API_KEY is not set in .env");
  const started = performance.now();
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await Bun.sleep(Math.min(20_000, 1000 * 2 ** attempt + Math.random() * 500));
    let res: Response;
    try {
      res = await fetch(`${cfg.anthropicBaseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ ...req, stream: true }),
        signal: AbortSignal.timeout(10 * 60_000),
      });
    } catch (e) {
      lastErr = errorMessage(e);
      continue;
    }
    const requestId = res.headers.get("request-id");
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      lastErr = `HTTP ${res.status}: ${body.slice(0, 500)}`;
      if (RETRYABLE.has(res.status)) {
        const ra = Number(res.headers.get("retry-after"));
        if (ra > 0 && ra < 60) await Bun.sleep(ra * 1000);
        continue;
      }
      return appErr("llm_http", lastErr, { status: res.status, requestId });
    }
    const acc = await accumulate(res.body, h);
    if (!acc.ok) {
      lastErr = acc.error.message;
      if (acc.error.code === "llm_overloaded") continue;
      return acc;
    }
    return ok({ response: acc.value, requestId, latencyMs: Math.round(performance.now() - started) });
  }
  return appErr("llm_retry_exhausted", `Failed to call the Claude API: ${lastErr}`);
};

type Partial = { block: ContentBlock; json: string };

/** Build a MessagesResponse from SSE events (message_start → content_block_* → message_delta). */
export async function accumulate(body: ReadableStream<Uint8Array>, h: StreamHandlers = {}): Promise<Result<MessagesResponse>> {
  let msg: MessagesResponse | null = null;
  const blocks: Partial[] = [];
  for await (const ev of parseSse(body)) {
    if (!ev.data || ev.data === "[DONE]") continue;
    let d: Record<string, any>;
    try {
      d = JSON.parse(ev.data);
    } catch {
      continue;
    }
    switch (d.type) {
      case "message_start": {
        const m = d.message;
        msg = { id: m.id, model: m.model, role: "assistant", content: [], stop_reason: null, usage: normUsage(m.usage) };
        break;
      }
      case "content_block_start": {
        const cb = d.content_block;
        const block: ContentBlock =
          cb.type === "tool_use" ? { type: "tool_use", id: cb.id, name: cb.name, input: {} } : cb.type === "thinking" ? { type: "thinking", thinking: "" } : cb.type === "text" ? { type: "text", text: cb.text ?? "" } : cb;
        blocks[d.index] = { block, json: "" };
        break;
      }
      case "content_block_delta": {
        const p = blocks[d.index];
        if (!p) break;
        const delta = d.delta;
        if (delta.type === "text_delta" && p.block.type === "text") {
          p.block.text += delta.text;
          h.onText?.(delta.text);
        } else if (delta.type === "input_json_delta") p.json += delta.partial_json;
        else if (delta.type === "thinking_delta" && p.block.type === "thinking") p.block.thinking += delta.thinking;
        else if (delta.type === "signature_delta" && p.block.type === "thinking") p.block.signature = delta.signature;
        break;
      }
      case "content_block_stop": {
        const p = blocks[d.index];
        if (p && p.block.type === "tool_use") {
          try {
            p.block.input = p.json ? JSON.parse(p.json) : {};
          } catch {
            p.block.input = { __invalid_json: p.json };
          }
        }
        break;
      }
      case "message_delta": {
        if (!msg) break;
        msg.stop_reason = d.delta?.stop_reason ?? msg.stop_reason;
        if (d.usage) {
          const u = normUsage({ ...msg.usage, ...d.usage });
          msg.usage = { ...msg.usage, ...u, output_tokens: d.usage.output_tokens ?? msg.usage.output_tokens };
        }
        break;
      }
      case "error": {
        const t = d.error?.type ?? "error";
        return appErr(t === "overloaded_error" ? "llm_overloaded" : "llm_stream_error", `${t}: ${d.error?.message ?? ""}`);
      }
    }
  }
  if (!msg) return appErr("llm_empty", "Empty stream response");
  msg.content = blocks.filter(Boolean).map((p) => p.block);
  return ok(msg);
}

function normUsage(u: Record<string, unknown> | undefined): Usage {
  const n = (k: string) => (typeof u?.[k] === "number" ? (u[k] as number) : 0);
  return {
    input_tokens: n("input_tokens"),
    output_tokens: n("output_tokens"),
    cache_creation_input_tokens: n("cache_creation_input_tokens"),
    cache_read_input_tokens: n("cache_read_input_tokens"),
  };
}

// The transport follows the saved Settings choice; tests can override it with a mock.
let override: LlmTransport | null = null;
export const setTransport = (t: LlmTransport | null) => {
  override = t;
};
export const getTransport = (): LlmTransport => {
  if (override) return override;
  const engine = llmEngine();
  return engine === "api" ? httpTransport : cliTransport(engine);
};

/** Whether optional LLM steps (ingest extraction, memory, report narrative) should run: an injected transport or a configured engine. */
export const llmAvailable = (): boolean => override !== null || llmStatus().ok;

/** Whether LLM calls can run at all, for health checks and early "not configured" messages. */
export function llmStatus(): { ok: boolean; engine: string; detail: string } {
  const cfg = config();
  const engine = llmEngine();
  if (engine === "api") return { ok: !!cfg.anthropicApiKey, engine, detail: cfg.anthropicApiKey ? "Messages API, ANTHROPIC_API_KEY set" : "ANTHROPIC_API_KEY is empty in .env; select a CLI in Settings or add the API key" };
  const bin = cliBinary(engine);
  return { ok: !!bin, engine, detail: bin ? `${engine} via ${bin} (development only, no API cost tracked)` : `${engine} CLI is not on PATH` };
}
