# 15 · Roadmap & Milestones

Estimates for one part-time developer with coding-agent assistance. Every milestone is independently usable.

## MVP cut

The MVP is a **read-only investigation copilot**: M0 + M1 + M2 + M3, plus the Markdown/PDF part of M5.

| In the MVP | Deferred |
|---|---|
| Issue + attachment ingestion, entities | Screen recording, before/after video (M6) |
| SDF repo indexer + dependency graph | Fix, validate, sandbox deploy, verify → E5 (M6) |
| Agent investigation: repo, SuiteQL, MCP, execution logs (read only) | Proactive monitoring (M7) |
| Evidence board, hypotheses, agent chat, consultant assistant | Browser reproduce/capture and the full browser production guard (M4) |
| Token usage, budget, loop control | XLSX report (CSV/Markdown are enough for now) |
| Markdown + PDF report | Multi-provider model routing |

Deferred code already in the repo stays, but is not a release blocker and is not tuned until the MVP gate passes.

**MVP gate** (`bun run eval`, cases in `evals/cases/`, 10 to 20 historical issues with a known root cause):

| Metric | Target |
|---|---|
| Root cause accuracy (expected level + file + keywords) | ≥ 60% |
| Median cost per issue | Under the project budget (default USD 3) |
| Cache hit ratio | ≥ 70% (Messages API engine only) |
| Median input tokens per LLM call | < 15k |
| Median tool calls per session | < 25 |

Case format: `{ id, title, description, repo?, attachments?, budget_usd?, expect: { min_level, files?, keywords? } }`.
`keywords` entries use `a|b` for alternatives. Results are written to `data/evals/`.

## M0 · Spikes (± 1 week)

Goal: remove technical uncertainty before building.

| Spike | Question | Pass criteria | If it fails |
|---|---|---|---|
| S-01 | `Bun.WebView`: can it pick the Chrome backend, a persistent profile/user-data-dir, headless vs. headed, popups/new tabs, file upload? | Log into sandbox with a saved profile, open a record, screenshot | ADR-004: optional Playwright |
| S-01b | `.cdp()`: `Page.startScreencast`, `Fetch.enable/failRequest`, `Page.printToPDF`, `Storage.getCookies` | Record 10s into an MP4, block a POST, print a PDF | Playwright for video/PDF |
| S-02 | MCP OAuth PKCE from a `127.0.0.1` callback, refresh token | `tools/list` succeeds from a Bun script | Redirect via `localhost` / a fixed port |
| S-03 | M2M JWT (Web Crypto) → SuiteQL | A simple query succeeds | Check the algorithm/kid |
| S-04 | `Bun.XML` on real sample SDF Objects | Parses 100% of the sample files | A simple fallback parser |
| S-05 | Execution log source via SuiteQL | A query for error logs per script & time range succeeds | A read-only RESTlet helper |
| S-06 | `zip.ts` reads real DOCX/XLSX and writes an XLSX that opens in Excel/LibreOffice/Google Sheets | Round trip passes | `fflate` via an ADR |

## M1 · Foundation & intake (± 2 weeks)

- Bun server (routes, HTML import, WS), SQLite + migrations, job queue + worker spawn.
- Project, environment (no credentials yet), repo pairing + SDF indexer.
- Issue CRUD, upload/paste attachments, ingestion for all v1 types, entities.
- Anthropic client (SSE), `llm_calls` + a basic usage UI, Settings for model & pricing.
- DESIGN.md → `tokens.css`, static inbox + issue workspace layouts.

**DoD:** An issue with 5 attachment types produces a correct summary + entities; cost is recorded.

## M2 · Core agent (± 2-3 weeks)

- State machine TRIAGE → INVESTIGATE → HYPOTHESIZE → ROOT_CAUSE → REPORT_DRAFT (no live NetSuite; using repo + attachments).
- Tool registry, evidence board, hypotheses, checkpoints, agent chat + intent, budget.
- Realtime timeline in the UI.

**DoD:** From an issue + repo, the agent points to the relevant file:line (static E4) for 3 historical test cases.

## M3 · Live NetSuite & access profiles (± 2 weeks)

- Wizard, credential encryption, MCP OAuth PKCE, M2M, capability probe, tiers.
- Tools `mcp_call`, `suiteql_query`, `get_record`, `get_system_notes`, `get_execution_logs`.
- Production guard in the registry, SuiteQL, MCP allowlist.

**DoD:** A sandbox issue automatically reaches E2; a production probe flags an exposed write tool.

## M4 · Browser runner (± 2 weeks)

- Login Assist, sessions, Repro DSL + validation, runner modes explore/reproduce/capture, highlighting, screenshots, redaction.
- Full browser production guard + audit.

**DoD:** 3 sandbox scenarios reproduce → E3; in production, every write action is blocked in guard tests.

## M5 · Report & consultant (± 1-2 weeks)

- ReportModel, preview, PDF via CDP, the XLSX writer, Markdown export.
- The consultant assistant + output filter + FAQ.

**DoD:** The PDF/XLSX report opens correctly; consultant drafts never contain a secret in regex testing.

## M6 · Recording, fix & verify (± 2-3 weeks)

- Screencast → MP4 + captions, before/after.
- Branch + patch, tests, `project:validate`, approval, sandbox deploy, verify_after → E5.

**DoD:** One real issue runs end-to-end to E5 with a before/after video.

## M7 · Proactive monitoring (± 1 week)

- `Bun.cron` log polling, error grouping, auto draft issue + triage, notifications.

## Backlog

Jira/Linear/GitHub Issues integration, OS keychain for the master key, embeddings + semantic search,
multi-language UI, `bun build --compile` for binary distribution, MSG/XLS support via an ADR.
