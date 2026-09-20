// Deterministic LLM transport for pipeline tests: answers structured calls by tool name and drives the agent loop
// from a per-state script of tool calls. Every request is recorded so tests can assert on context assembly.
import { ok } from "../../src/lib/result.ts";
import type { LlmTransport } from "../../src/llm/anthropic.ts";
import type { ContentBlock, MessagesRequest, MessagesResponse, TextBlock, Usage } from "../../src/llm/types.ts";

export type ScriptedCall = { name: string; input: Record<string, unknown> };
export type AgentRound = ScriptedCall[] | { text: string };

export type Script = {
  /** Structured calls (tool_choice = a single tool): tool name → input, or a function of the request. */
  structured: Record<string, Record<string, unknown> | ((req: MessagesRequest) => Record<string, unknown>)>;
  /** Agent tool loop: state → rounds. Round n answers the n-th assistant turn of that state's loop. */
  agent: Partial<Record<string, AgentRound[]>>;
  /** Plain text calls (no tools), e.g. chat questions. */
  text?: (req: MessagesRequest) => string;
  usage?: Partial<Usage>;
};

export type Recorded = { req: MessagesRequest; kind: "structured" | "agent" | "text"; state?: string; round?: number };

const firstUserText = (req: MessagesRequest): string => {
  const m = req.messages[0];
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  return m.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("\n");
};

export function scriptedTransport(script: Script): { transport: LlmTransport; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let seq = 0;
  const usage: Usage = { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000, ...script.usage };
  const respond = (content: ContentBlock[], stop: MessagesResponse["stop_reason"]) =>
    ok({ response: { id: `msg_${++seq}`, model: "", role: "assistant" as const, content, stop_reason: stop, usage }, requestId: `req_${seq}`, latencyMs: 1 });

  const transport: LlmTransport = async (req) => {
    const choice = req.tool_choice;
    if (choice && choice.type === "tool") {
      calls.push({ req, kind: "structured" });
      const entry = script.structured[choice.name];
      if (!entry) throw new Error(`scripted LLM: no structured answer for ${choice.name}`);
      const input = typeof entry === "function" ? entry(req) : entry;
      return respond([{ type: "tool_use", id: `tu_${seq + 1}`, name: choice.name, input }], "tool_use");
    }
    if (!req.tools?.length) {
      calls.push({ req, kind: "text" });
      return respond([{ type: "text", text: script.text?.(req) ?? "ok" }], "end_turn");
    }
    const state = /## Current state: (\w+)/.exec(firstUserText(req))?.[1] ?? "?";
    const round = req.messages.filter((m) => m.role === "assistant").length;
    calls.push({ req, kind: "agent", state, round });
    const r = script.agent[state]?.[round];
    if (!r) return respond([{ type: "text", text: `(script exhausted for ${state} round ${round})` }], "end_turn");
    if ("text" in r) return respond([{ type: "text", text: r.text }], "end_turn");
    return respond(r.map((c, k) => ({ type: "tool_use" as const, id: `tu_${seq + 1}_${k}`, name: c.name, input: c.input })), "tool_use");
  };
  return { transport, calls };
}

/** Tool results the orchestrator sent back after a given recorded agent call. */
export function toolResultsAfter(calls: Recorded[], state: string, round: number): { content: string; is_error: boolean }[] {
  const next = calls.find((c) => c.kind === "agent" && c.state === state && c.round === round + 1);
  const last = next?.req.messages.at(-1);
  if (!last || typeof last.content === "string") return [];
  return last.content.flatMap((b) => (b.type === "tool_result" ? [{ content: typeof b.content === "string" ? b.content : JSON.stringify(b.content), is_error: !!b.is_error }] : []));
}
