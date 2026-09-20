# 10 · Token Usage & Cost

## 1. Data source

Every Messages API response includes a `usage` object:
`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`.
For streaming, the final values come from the `message_delta` (output) and `message_start` (input/cache) events.

Every call is logged to `llm_calls` (see `schema/schema.sql`) with `issue_id`, `session_id`,
`step_id`, `purpose`, `model`, tokens, `latency_ms`, `stop_reason`, `request_id`.

## 2. Cost calculation

```ts
cost = input_tokens        * p.input_per_mtok       / 1e6
     + output_tokens       * p.output_per_mtok      / 1e6
     + cache_write_tokens  * p.cache_write_per_mtok / 1e6
     + cache_read_tokens   * p.cache_read_per_mtok  / 1e6;
```

- Pricing comes from `model_pricing` (filled in manually from the official pricing page, see `config/pricing.example.json`).
- A `pricing_snapshot` is stored per call so historical cost stays stable.
- A model with no price set → cost is `null` + a "pricing not set" badge (tokens are still recorded).

## 3. Aggregation & display

| Level | Display |
|---|---|
| Step | A small chip in the timeline: `in 12.4k · out 1.1k · cache 88% · $0.021` |
| Session | Session panel header: total tokens, cost, duration, tool call count, models used |
| Issue | A sidebar card on the issue: total cost vs. budget (a bar), a breakdown per `purpose` |
| Project / month | A Usage page: a table per issue, per model, daily trend |

**Cache hit ratio** = `cache_read / (input + cache_read + cache_write)`, shown to monitor how effective prompt caching is.

## 4. Budget

- The effective budget = `issues.budget_usd ?? projects.default_budget_usd`.
- Before every LLM call, `budget.ts` estimates the maximum cost (counted input tokens + `max_tokens` output)
  and rejects the call if it would exceed the remaining budget → the session becomes `budget_exceeded`.
- Events: `usage.warning` at 80%, `usage.exceeded` at 100%.
- An **Add budget** button (+USD 1/+USD 5/custom) followed by **Resume**.

## 5. Cost-saving strategy (on by default)

1. Prompt caching on the system prompt + project context (doc 05 §5).
2. Haiku for ingestion, triage, chat intent classification, and the consultant assistant.
3. Tool output truncated to a preview; the full data lives in a file.
4. Images resized before sending; large PDFs sent by page range.
5. The evidence board replaces a long transcript.
6. Opus escalation only when requested/triggered (doc 05 §3).

## 6. Usage export

The **Token Usage** sheet in the XLSX report: per call (time, purpose, model, tokens, cost) + a summary.
The "include cost" option can be turned off for reports sent to other parties.
