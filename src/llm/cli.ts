// Development-only LLM engine (ADR-008): drive a local coding CLI instead of the Messages API, so NSIC can run without
// ANTHROPIC_API_KEY. NSIC tools are described in the prompt, and the model answers with a JSON envelope
// that is turned back into tool_use blocks, so callLlm,
// callStructured and the orchestrator loop work unchanged. Each call is stateless: the full transcript is re-sent.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, type LlmEngine } from "../config.ts";
import { type Result, ok, appErr, errorMessage } from "../lib/result.ts";
import type { LlmTransport } from "./anthropic.ts";
import type { ContentBlock, MessagesRequest, MessagesResponse, ToolUseBlock, Usage } from "./types.ts";

export type CliEngine = Exclude<LlmEngine, "api">;

const BINS: Record<CliEngine, string> = { "claude-code": "claude", codex: "codex" };
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "application/pdf": "pdf" };

export const cliBinary = (e: CliEngine): string | null => {
  const want = config().llmCliBin ?? BINS[e];
  return want.includes("/") ? want : Bun.which(want);
};

// ---------- request → prompt ----------

type Rendered = { system: string; prompt: string; files: string[] };

/** Flatten a Messages API request into a system prompt, a transcript and attachment files written to `dir`. */
export function renderRequest(req: MessagesRequest, dir: string): Rendered {
  const files: string[] = [];
  const attach = (media: string, data: string) => {
    const name = `attachment-${files.length + 1}.${EXT[media] ?? "bin"}`;
    writeFileSync(join(dir, name), Buffer.from(data, "base64"));
    files.push(name);
    return `[attachment: ${name}]`;
  };
  const block = (b: ContentBlock): string => {
    switch (b.type) {
      case "text":
        return b.text;
      case "image":
        return attach(b.source.media_type, b.source.data);
      case "document":
        return `${b.title ? `${b.title} ` : ""}${attach(b.source.media_type, b.source.data)}`;
      case "tool_use":
        return `<tool_call id="${b.id}" name="${b.name}">${JSON.stringify(b.input)}</tool_call>`;
      case "tool_result": {
        const body = typeof b.content === "string" ? b.content : b.content.map(block).join("\n");
        return `<tool_result id="${b.tool_use_id}"${b.is_error ? ' error="true"' : ""}>\n${body}\n</tool_result>`;
      }
      case "thinking":
        return "";
    }
  };
  const turns = req.messages.map((m) => {
    const body = typeof m.content === "string" ? m.content : m.content.map(block).filter(Boolean).join("\n\n");
    return `<turn role="${m.role}">\n${body}\n</turn>`;
  });

  const sys = typeof req.system === "string" ? req.system : (req.system ?? []).map((b) => b.text).join("\n\n");
  const parts = [sys, BRIDGE];
  if (files.length) parts.push(`Attachments referenced as [attachment: name] are files in the working directory. Open them to read their content.`);
  const tools = req.tool_choice?.type === "none" ? [] : (req.tools ?? []);
  if (tools.length) {
    const defs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    const choice = req.tool_choice;
    const rule =
      choice?.type === "tool"
        ? `You must call the tool "${choice.name}" exactly once; "tool_calls" must contain exactly that one call.`
        : choice?.type === "any"
          ? `You must call at least one tool.`
          : `Call tools when you need them. When you are finished, return "tool_calls": [] and put your answer in "text".`;
    parts.push(
      `Available tools (input is JSON Schema):\n<tools>\n${JSON.stringify(defs, null, 1)}\n</tools>\n\n` +
        `Reply with ONE JSON object and nothing else, no code fences:\n` +
        `{"text": "<message for the user, may be empty>", "tool_calls": [{"name": "<tool name>", "input": {}}]}\n` +
        `${rule} Tool results come back in the next turn inside <tool_result> blocks.`,
    );
  }
  return { system: parts.filter(Boolean).join("\n\n"), prompt: `<conversation>\n${turns.join("\n")}\n</conversation>`, files };
}

const BRIDGE =
  "You are reached through a text-only bridge. You cannot run commands, edit files or browse; ignore any built-in tools. " +
  "The conversation so far is in <conversation>; answer as the assistant's next turn.";

// ---------- model text → response ----------

/** Parse the model's reply into content blocks. Plain text is accepted when no tool is required. */
export function parseReply(text: string, req: MessagesRequest): Result<{ content: ContentBlock[]; stop: MessagesResponse["stop_reason"] }> {
  const tools = req.tool_choice?.type === "none" ? [] : (req.tools ?? []);
  if (!tools.length) return ok({ content: [{ type: "text", text: text.trim() }], stop: "end_turn" });
  const forced = req.tool_choice?.type === "tool" ? req.tool_choice.name : null;
  const known = new Set(tools.map((t) => t.name));
  let obj = extractJson(text);
  // Recover calls written outside the envelope, e.g. `tool_call\n{"name": ..., "input": ...}`, possibly several.
  const bare = (o: Record<string, any> | null) => !!o && typeof o.name === "string" && "input" in o && !("tool_calls" in o);
  if (!obj || bare(obj)) {
    const found = jsonObjects(text);
    const env = found.find((o) => Array.isArray(o.tool_calls));
    const loose = found.filter((o) => bare(o) && known.has(o.name));
    if (env) obj = env;
    else if (loose.length) obj = { text: "", tool_calls: loose };
    else if (bare(obj) && !forced) obj = null;
  }
  if (!obj) {
    if (forced || req.tool_choice?.type === "any") return appErr("llm_invalid_output", `The CLI model did not return JSON: ${text.slice(0, 300)}`);
    return ok({ content: [{ type: "text", text: text.trim() }], stop: "end_turn" });
  }
  let calls: { name: string; input: unknown }[] = Array.isArray(obj.tool_calls)
    ? obj.tool_calls.filter((c: any) => c && typeof c.name === "string" && known.has(c.name)).map((c: any) => ({ name: c.name, input: c.input ?? {} }))
    : [];
  // A forced call sometimes comes back as the bare tool input.
  if (forced && !calls.length && !("tool_calls" in obj)) calls = [{ name: forced, input: obj }];
  if (forced) calls = calls.filter((c) => c.name === forced).slice(0, 1);
  if (forced && !calls.length) return appErr("llm_no_tool", `The CLI model did not call ${forced}`);
  const content: ContentBlock[] = [];
  if (typeof obj.text === "string" && obj.text.trim()) content.push({ type: "text", text: obj.text.trim() });
  for (const c of calls) content.push({ type: "tool_use", id: `toolu_cli_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`, name: c.name, input: c.input } satisfies ToolUseBlock);
  return ok({ content, stop: calls.length ? "tool_use" : "end_turn" });
}

/** Every top-level JSON object in free text (brace matching that respects strings). */
export function jsonObjects(text: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = depth > 0;
    else if (ch === "{") {
      if (depth++ === 0) start = i;
    } else if (ch === "}" && depth > 0 && --depth === 0) {
      try {
        const v = JSON.parse(text.slice(start, i + 1));
        if (v && typeof v === "object" && !Array.isArray(v)) out.push(v);
      } catch {
        /* not JSON; keep scanning */
      }
    }
  }
  return out;
}

export function extractJson(text: string): Record<string, any> | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  for (const s of [t, t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)]) {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

// ---------- per-CLI invocation ----------

type Run = { text: string; usage: Usage; model: string };

async function exec(cmd: string[], opts: { cwd: string; stdin?: string; unsetEnv?: string[]; isolatedEnv?: boolean }): Promise<Result<{ stdout: string; stderr: string }>> {
  const env = opts.isolatedEnv
    ? Object.fromEntries(["PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP", "CODEX_HOME", "SYSTEMROOT", "WINDIR"].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]!]))
    : { ...process.env };
  for (const k of opts.unsetEnv ?? []) delete env[k];
  try {
    const p = Bun.spawn(cmd, {
      cwd: opts.cwd,
      stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
      stdout: "pipe",
      stderr: "pipe",
      env,
      timeout: config().llmCliTimeoutMs,
    });
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (p.signalCode) return appErr("llm_cli", `${cmd[0]} was stopped (${p.signalCode}); timeout is ${config().llmCliTimeoutMs} ms`);
    if (code !== 0) return appErr("llm_cli", `${cmd[0]} exited with ${code}: ${stderr.slice(-800)}`);
    return ok({ stdout, stderr });
  } catch (e) {
    return appErr("llm_cli", `Could not start ${cmd[0]}: ${errorMessage(e)}`);
  }
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** The model that did the work: Claude Code also runs small side calls (e.g. Haiku), so pick the one with the most output. */
export function mainModel(modelUsage: unknown, fallback: string): string {
  if (!modelUsage || typeof modelUsage !== "object") return fallback;
  const rows = Object.entries(modelUsage as Record<string, Record<string, unknown>>).map(([m, u]) => ({ m, out: num(u?.outputTokens) + num(u?.inputTokens) / 1000 }));
  return rows.sort((a, b) => b.out - a.out)[0]?.m ?? fallback;
}

async function runClaudeCode(bin: string, r: Rendered, req: MessagesRequest, dir: string): Promise<Result<Run>> {
  const model = req.model;
  const cmd = [bin, "-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "", "--permission-mode", "dontAsk"];
  cmd.push("--model", model, "--system-prompt", r.system, "--tools", r.files.length ? "Read" : "");
  if (r.files.length) cmd.push("--allowedTools", "Read");
  if (req.output_config?.effort) cmd.push("--effort", req.output_config.effort);
  // Drop the API key so the CLI uses its own login (subscription), not the API account.
  const x = await exec(cmd, { cwd: dir, stdin: r.prompt, unsetEnv: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"] });
  if (!x.ok) return x;
  const out = extractJson(x.value.stdout.trim().split("\n").at(-1) ?? "");
  if (!out) return appErr("llm_cli", `Unexpected claude output: ${x.value.stdout.slice(0, 300)}`);
  if (out.is_error) return appErr("llm_cli", `Claude Code: ${out.result ?? out.subtype ?? "error"}`);
  const u = out.usage ?? {};
  const usage = { input_tokens: num(u.input_tokens), output_tokens: num(u.output_tokens), cache_creation_input_tokens: num(u.cache_creation_input_tokens), cache_read_input_tokens: num(u.cache_read_input_tokens) };
  return ok({ text: String(out.result ?? ""), usage, model: mainModel(out.modelUsage, model) });
}

/** Extract the final assistant turn and cumulative usage from `codex exec --json` events. */
export function parseCodexEvents(stdout: string, model = "default"): Result<Run> {
  let answer: string | null = null;
  let usage: Usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let completed = false;
  let failure: string | null = null;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try { event = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (event.type === "item.completed") {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type === "agent_message" && typeof item.text === "string") answer = item.text;
    } else if (event.type === "turn.completed") {
      completed = true;
      const u = event.usage as Record<string, unknown> | undefined;
      usage = { input_tokens: num(u?.input_tokens), output_tokens: num(u?.output_tokens), cache_creation_input_tokens: 0, cache_read_input_tokens: num(u?.cached_input_tokens) };
    } else if (event.type === "turn.failed" || event.type === "error") {
      failure = typeof event.message === "string" ? event.message : "Codex turn failed";
    }
  }
  if (!completed) return appErr("llm_cli", failure ?? "Codex did not complete a turn");
  if (answer === null) return appErr("llm_cli", "Codex completed without an assistant message");
  return ok({ text: answer, usage, model });
}

async function runCodex(bin: string, r: Rendered, req: MessagesRequest, dir: string): Promise<Result<Run>> {
  const cmd = [bin, "exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only"];
  const model = req.model === "default" ? undefined : req.model;
  if (model) cmd.push("--model", model);
  cmd.push("-");
  const x = await exec(cmd, { cwd: dir, stdin: `${r.system}\n\n${r.prompt}`, isolatedEnv: true });
  if (!x.ok) return x;
  return parseCodexEvents(x.value.stdout, model ?? "default");
}

const RUNNERS: Record<CliEngine, (bin: string, r: Rendered, req: MessagesRequest, dir: string) => Promise<Result<Run>>> = {
  "claude-code": runClaudeCode,
  codex: runCodex,
};

export function cliTransport(engine: CliEngine): LlmTransport {
  return async (req, h) => {
    const bin = cliBinary(engine);
    if (!bin) return appErr("llm_no_key", `${engine} CLI is not on PATH`);
    const started = performance.now();
    const dir = mkdtempSync(join(tmpdir(), "nsic-llm-"));
    try {
      const rendered = renderRequest(req, dir);
      const run = await RUNNERS[engine](bin, rendered, req, dir);
      if (!run.ok) return run;
      const parsed = parseReply(run.value.text, req);
      if (!parsed.ok) return parsed;
      for (const b of parsed.value.content) if (b.type === "text") h.onText?.(b.text);
      // The model name is prefixed with the engine so subscription calls never match an API price (cost stays empty).
      const response: MessagesResponse = { id: `cli_${crypto.randomUUID()}`, model: `${engine}:${run.value.model}`, role: "assistant", content: parsed.value.content, stop_reason: parsed.value.stop, usage: run.value.usage };
      return ok({ response, requestId: null, latencyMs: Math.round(performance.now() - started) });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
