# ADR-008 · Local CLI as a development LLM engine

Status: Accepted (development only) · 2026-09-19

## Context
Every LLM call goes through `src/llm/anthropic.ts` and needs `ANTHROPIC_API_KEY`. During development we want to run
the agent, ingest, triage, chat, report drafts and the consultant with a local Claude Code login instead.

## Decision
Store the engine (`api` | `claude-code` | `codex`, default `api`) and per-engine model profiles in SQLite through Settings. With either local CLI, `src/llm/cli.ts` implements the existing
`LlmTransport`:
- The request is flattened into a system prompt plus a `<conversation>` transcript. Images and PDFs become files in a
  temporary working directory. Claude Code receives only its Read tool; Codex runs in read-only mode from the temporary
  directory with user settings and rules disabled and a small environment allowlist. Sessions are not persisted.
- NSIC tools are described in the prompt. The model replies with `{"text", "tool_calls": [{name, input}]}`, which is
  converted back into `tool_use` blocks, so `callLlm`, `callStructured` and the orchestrator loop are unchanged.
  The guard, approvals and auditing still run in NSIC.
- Codex model inputs default to `default`, which uses the CLI's configured model. A model ID in a role input overrides it. Claude role model IDs are not passed to Codex.
- The recorded model is prefixed (`claude-code:<model>` or `codex:<model>`), so no API price matches and cost stays empty.
No new dependency.

## Consequences
+ The whole product runs on a developer machine without an API key.
- Each call is stateless (the full transcript is re-sent), slower, and has no prompt caching or streaming.
- Tool calling is prompted, not native: malformed JSON fails the call (`llm_invalid_output`).
- Usage and budgets are not meaningful in this mode.
- CLI logins are for personal development use; production and anything used by other people stays on `api`.
