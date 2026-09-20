// CLI LLM bridge (ADR-008): request rendering and reply parsing. The CLI itself is never started here.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliTransport, extractJson, jsonObjects, mainModel, parseCodexEvents, parseReply, renderRequest } from "../../src/llm/cli.ts";
import { config, setConfigForTest } from "../../src/config.ts";
import type { MessagesRequest } from "../../src/llm/types.ts";

const tool = { name: "record_triage", description: "Record triage", input_schema: { type: "object", properties: { severity: { type: "string" } } } };
const base: MessagesRequest = { model: "claude-haiku-4-5", max_tokens: 100, system: "You triage issues.", messages: [{ role: "user", content: "Invoice total is wrong" }] };

describe("renderRequest", () => {
  test("plain request has no tool protocol", () => {
    const r = renderRequest(base, mkdtempSync(join(tmpdir(), "nsic-cli-")));
    expect(r.system).toContain("You triage issues.");
    expect(r.system).not.toContain("<tools>");
    expect(r.prompt).toContain('<turn role="user">\nInvoice total is wrong\n</turn>');
  });

  test("forced tool, tool history and attachments", () => {
    const dir = mkdtempSync(join(tmpdir(), "nsic-cli-"));
    const r = renderRequest(
      {
        ...base,
        tools: [tool],
        tool_choice: { type: "tool", name: "record_triage" },
        messages: [
          { role: "user", content: [{ type: "text", text: "See screenshot" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }] },
          { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "record_triage", input: { severity: "high" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "saved", is_error: true }] },
        ],
      },
      dir,
    );
    expect(r.system).toContain('You must call the tool "record_triage" exactly once');
    expect(r.prompt).toContain('<tool_call id="t1" name="record_triage">{"severity":"high"}</tool_call>');
    expect(r.prompt).toContain('<tool_result id="t1" error="true">\nsaved\n</tool_result>');
    expect(r.files).toEqual(["attachment-1.png"]);
    expect(readdirSync(dir)).toContain("attachment-1.png");
  });
});

describe("parseReply", () => {
  const forced: MessagesRequest = { ...base, tools: [tool], tool_choice: { type: "tool", name: "record_triage" } };
  const auto: MessagesRequest = { ...base, tools: [tool] };

  test("envelope with a tool call becomes tool_use", () => {
    const r = parseReply('```json\n{"text":"ok","tool_calls":[{"name":"record_triage","input":{"severity":"low"}}]}\n```', forced);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stop).toBe("tool_use");
    expect(r.value.content[1]).toMatchObject({ type: "tool_use", name: "record_triage", input: { severity: "low" } });
  });

  test("forced tool accepts the bare input object", () => {
    const r = parseReply('Here it is: {"severity":"medium"}', forced);
    expect(r.ok && r.value.content[0]).toMatchObject({ type: "tool_use", input: { severity: "medium" } });
  });

  test("unknown tools are dropped; forced tool without a call is an error", () => {
    expect(parseReply('{"tool_calls":[{"name":"rm_rf","input":{}}]}', forced).ok).toBe(false);
    const r = parseReply('{"text":"done","tool_calls":[{"name":"rm_rf","input":{}}]}', auto);
    expect(r.ok && r.value.stop).toBe("end_turn");
  });

  test("auto mode accepts plain text as the final answer", () => {
    const r = parseReply("The cause is a rounding rule.", auto);
    expect(r.ok && r.value.content).toEqual([{ type: "text", text: "The cause is a rounding rule." }]);
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("mainModel", () => {
  test("picks the model that produced the answer, not a side call", () => {
    const usage = { "claude-haiku-4-5-20251001": { inputTokens: 300, outputTokens: 20 }, "claude-sonnet-5": { inputTokens: 9000, outputTokens: 800 } };
    expect(mainModel(usage, "sonnet")).toBe("claude-sonnet-5");
    expect(mainModel(undefined, "sonnet")).toBe("sonnet");
  });
});

describe("Codex JSONL result", () => {
  test("takes the final assistant message and token usage", () => {
    const events = [
      { type: "thread.started", thread_id: "thread-1" },
      { type: "item.completed", item: { type: "agent_message", text: "draft" } },
      { type: "item.completed", item: { type: "agent_message", text: '{"text":"done","tool_calls":[]}' } },
      { type: "turn.completed", usage: { input_tokens: 150, cached_input_tokens: 80, output_tokens: 25 } },
    ].map((event) => JSON.stringify(event)).join("\n");
    const parsed = parseCodexEvents(events);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.text).toBe('{"text":"done","tool_calls":[]}');
    expect(parsed.value.usage).toEqual({ input_tokens: 150, output_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 80 });
  });

  test("rejects failed and incomplete turns", () => {
    expect(parseCodexEvents('{"type":"turn.failed","message":"denied"}').ok).toBe(false);
    expect(parseCodexEvents('{"type":"turn.completed","usage":{}}').ok).toBe(false);
  });

  test("Codex runner bridges a tool call with read-only CLI settings", async () => {
    const original = config();
    const dir = mkdtempSync(join(tmpdir(), "nsic-codex-test-"));
    const bin = join(dir, "codex-fake");
    writeFileSync(bin, `#!/bin/sh
[ "$1" = "exec" ] || exit 2
case " $* " in *" --sandbox read-only "*) ;; *) exit 3;; esac
[ -z "$NSIC_MASTER_KEY" ] || exit 4
cat >/dev/null
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"text\\":\\"\\",\\"tool_calls\\":[{\\"name\\":\\"record_triage\\",\\"input\\":{\\"severity\\":\\"high\\"}}]}"}}' '{"type":"turn.completed","usage":{"input_tokens":42,"output_tokens":9}}'
`);
    chmodSync(bin, 0o755);
    setConfigForTest({ ...original, llmCliBin: bin });
    try {
      const result = await cliTransport("codex")({ ...base, model: "default", tools: [tool], tool_choice: { type: "tool", name: tool.name } }, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.response.model).toBe("codex:default");
      expect(result.value.response.content[0]).toMatchObject({ type: "tool_use", name: "record_triage", input: { severity: "high" } });
      expect(result.value.response.usage.input_tokens).toBe(42);
    } finally {
      setConfigForTest(original);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseReply recovery", () => {
  const req = { model: "m", max_tokens: 10, messages: [], tools: [{ name: "add_evidence", description: "", input_schema: {} }, { name: "complete_state", description: "", input_schema: {} }] } as MessagesRequest;
  test("calls written outside the envelope are recovered", () => {
    const text = 'Recording it now.\ntool_call\n{"name": "add_evidence", "input": {"level": 4, "body": "a } brace in a string"}}\n{"name": "complete_state", "input": {"next": "HYPOTHESIZE"}}';
    const r = parseReply(text, req);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const uses = r.value.content.filter((b) => b.type === "tool_use");
    expect(uses.map((u) => (u as { name: string }).name)).toEqual(["add_evidence", "complete_state"]);
    expect(r.value.stop).toBe("tool_use");
  });
  test("an envelope after prose is found", () => {
    const r = parseReply('Sure.\n{"text": "hi", "tool_calls": [{"name": "complete_state", "input": {}}]} trailing', req);
    expect(r.ok && r.value.stop).toBe("tool_use");
  });
  test("unknown names are dropped and prose stays text", () => {
    expect(jsonObjects('x {"a": "{"} y {"b": 1}')).toEqual([{ a: "{" }, { b: 1 }]);
    const r = parseReply('No JSON {"name": "rm_rf", "input": {}}', req);
    expect(r.ok && r.value.stop).toBe("end_turn");
    expect(r.ok && r.value.content).toEqual([{ type: "text", text: 'No JSON {"name": "rm_rf", "input": {}}' }]);
  });
});
