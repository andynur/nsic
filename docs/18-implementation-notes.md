# 18 · Implementation Notes & PRD Revisions (Sep 18, 2026)

This document records the spike results run during initial setup, decisions that
refined/sharpened the PRD, and the status of each code area. The other PRD sections have already
been updated to match these notes; the table below is their changelog.

## 1. Spike results (M0)

| Spike | Status | Result |
|---|---|---|
| S-01 `Bun.WebView` Chrome backend | **Partially passed** | The Chrome backend, a persistent profile (`dataStore.directory` = `--user-data-dir`), cookies, `evaluate`, native clicks, and screenshots all work on Bun 1.4.2. **Headed mode isn't supported** (`headless: true` only), so Login Assist launches Chrome directly (`Bun.spawn`) with the same profile, and the runner then uses that profile headlessly. Popups/new tabs and file upload haven't been tested yet. Chrome cold start is ~7s. |
| S-01b `.cdp()` | **Passed** | `Page.startScreencast` (frame + ack), `Fetch.enable` + `Fetch.failRequest` (POST blocked), `Page.printToPDF`, `Storage.getCookies`, and `Page.addScriptToEvaluateOnNewDocument` all work. ADR-004 (Playwright) doesn't need to be activated yet. |
| S-04 `Bun.XML` on SDF | **Passed for SDF objects** | Works well for `Objects/*.xml`. **Doesn't work for DOCX/XLSX**: repeated tags get grouped, losing mixed-content order (`w:r`/`w:hyperlink`). DOCX/XLSX use a sequential XML tokenizer instead (`src/ingest/xml-tokens.ts`). |
| S-06 `zip.ts` | **Passed** | Round trip verified with `unzip -t`; the XLSX writer's output was read back successfully by its own reader (test). Not yet opened in Excel/LibreOffice. |
| S-02, S-03, S-05 | Not yet run | These need a NetSuite account. M2M uses an **EC P-256 / ES256** key with a self-signed X.509 certificate (validated with `openssl verify`); if NetSuite rejects EC, fall back to PS256. |

## 2. PRD revisions

| # | Section | Revision | Reason |
|---|---|---|---|
| R1 | 01 §8, 14 | **Static UI mode** (`bun run ui`): the SPA is served by a UI-only server with no DB/job/LLM; every `/api/*` call is answered by an in-browser fixture with the same contract | UI/UX revisions never touch the backend; fast design review |
| R2 | AGENTS rule 1, 05 §4, 06 §6 | Tools now have a `scope`: `nsic` (NSIC DB/files), `workspace` (local repo/SDF), `netsuite`. Production allows `risk=read` **or** `local_write` with `scope=nsic` | The old rule ("risk != read is never allowed in production") excluded `add_evidence`/`ask_user`, which must be available at tier P |
| R3 | 05 §5 | Every tool that passes the tier filter is sent in every state (deterministic order); per-state limits are enforced at execution time | Changing the tool list per state would invalidate the prompt cache (tools sit at the start of the prefix) |
| R4 | 05 §4 | A new `complete_state {next, summary}` tool; transitions are validated against the allowed `next` values | Structured transitions instead of guessing from text |
| R5 | 05 §2 | Evidence rules are enforced inside `add_evidence`: E2 needs `ref.query/log/record`, E3 needs a `ref.run_id` for this issue's run, E4 needs `file+line`/`scriptid`/`object`/`workflow`/`permission` + a mechanism, E5 comes only from a `verify_after` replay | Evidence-first enforced by code, not by a prompt |
| R6 | 03 §6, 10 | Model id `claude-haiku-4-5` (alias). Default pricing USD/MTok: Sonnet 5 2/10, Opus 5 5/25, Haiku 4.5 1/5; cache write 1.25x, read 0.1x | Official pricing as of the document date; the table can still be changed in Settings |
| R7 | 04 | Migration `002`: `projects.key_prefix/next_issue_seq`, `environments.mcp_url/monitor_enabled/last_polled_at`, `issues.triage/questions_for_client`, table `report_drafts`, `oauth_states` | Columns the PRD flow needs but that weren't yet in the schema |
| R8 | 13 | New routes: `GET /api/session` (CSRF), `PUT /api/environments/:id/sdf` (authId), `GET /api/attachments/:id/thumb`, `POST /api/issues/:id/entities`, `PATCH /api/reports/:id`, `POST /api/messages/:id/faq`, `GET /api/system/check`, `GET /api/audit`, `GET /api/jobs`, `GET/PUT /api/settings/general` | UI needs that had no endpoint yet |
| R9 | 08 §2 | Login Assist = headed Chrome via `Bun.spawn` + the env profile; `Bun.WebView` headless for the runner | Result of S-01 |
| R10 | 09 §3 | DOCX/XLSX use a sequential tokenizer, not `Bun.XML` | Result of S-04 |
| R11 | 06 §4 | Tier: production → `P` with any access at all; sandbox `A` = MCP+REST+SDF, `B` = REST+SDF or MCP+REST, `C` = a browser session or MCP alone | Combinations the old PRD didn't cover |
| R12 | 07 §8 | A `trigger=monitor` session stops after TRIAGE | Cost savings per the PRD, now explicit in the state machine |
| R13 | config | `tsconfig` needs `allowImportingTsExtensions`; font CSS uses relative URLs (`../fonts/…`) so the HTML import bundles them | Found during the build |
| R14 | 14 §4 | Below 640 px: Summary / Agent / Artifacts tabs (implemented) | Matches the PRD, now built |
| R15 | DESIGN §2, 14 §10 | Light theme by default with a user-controlled dark switch (nav + Settings), replacing `prefers-color-scheme` | Predictable default for a work tool; the user decides |
| R16 | 13, 14 §4 | Deploy checkpoint messages carry `meta.approval { toolCallId, branch, files, objects?, diff }`; the approval block shows the change list and diff | The spec required a diff + object list; the UI previously showed only Approve/Reject |
| R17 | all | English only for UI copy, report text (HTML/MD/XLSX), server/validation messages, LLM instructions, and code comments. Non-English text remains only in matchers for client data, localized UI labels, reply headers, chat synonyms, and localized Word heading styles | One language standard across the product |
| R18 | 03 §2, ADR-008 | Settings selects Claude API, Claude Code, or Codex and saves separate model profiles in SQLite; CLI calls bridge NSIC tools as a JSON envelope. API remains the default. | Develop and demo without an API key |

## 3. Code status

| Area | Status |
|---|---|
| UI (every screen in 14 §1) + static mode | Done as a prototype; verified with light/dark screenshots at 1440 px and 390 px |
| DB, migrations, repo, job queue, worker, cron | Done, typecheck passes |
| Ingestion (image, PDF, DOCX, XLSX, CSV, EML, text) + entities | Done; the LLM step is optional (regex fallback) |
| SDF repo indexer + graph | Done, tested against the `tests/fixtures/sdf-repo` fixture |
| Agent (state machine, tool registry, guard, chat, consultant) | Done; end-to-end tested with a scripted LLM (`tests/e2e`) and with a real model through Claude Code (§4) |
| NetSuite (OAuth PKCE, M2M, MCP, SuiteQL, SDF, probe) | Written, pending S-02/S-03/S-05 |
| Browser runner, guard, redaction, recorder | Written; the guard has unit tests, the runner hasn't been tested against NetSuite yet |
| Report (HTML, PDF, XLSX, MD, ZIP) | Done; PDF depends on Chrome |

Recommended next steps: review the static UI → lock the design → run the backend with a real
API key + one sandbox for S-02/S-03/S-05 → run an end-to-end test on the ACME-42 fixture issue.

## 4. MVP hardening (Sep 19, 2026)

The MVP cut and its eval gate are defined in doc 15. This pass made the read-only investigation path run end to end.

| Area | Change |
|---|---|
| Tests | `tests/e2e/pipeline.test.ts`: repo index → issue + EML/CSV → ingest → TRIAGE…REPORT_DRAFT → chat → MD/XLSX export, with a scripted transport (`tests/helpers/scripted-llm.ts`). Also asserts the E4 rule, the stable cached prefix, cost per call, budget stop, and client-report filtering |
| Eval | `bun run eval` (`src/eval/`): replays `evals/cases/*.json` in a throwaway data dir and checks the MVP gate. Three seed cases on the fixture repo; add 10 to 20 real historical issues |
| Bug | Waiting for the user after a root cause overwrote `root_caused` with `awaiting_user`, so solved issues never showed as root caused |
| Bug | Any evidence ≥ E3 labelled the issue `reproduced`, including E4 from static code reading. Now only real E3 evidence does |
| Bug | Ingest extraction, cross-issue memory, report narrative, chat, and the consultant checked `ANTHROPIC_API_KEY` directly, so the `claude-code` engine silently skipped them. They now use `llmAvailable()` |
| Bug | The CLI engine recorded the first model in `modelUsage` (often Claude Code's own Haiku side call) instead of the model that answered |
| Report | Client timeline shows milestones only (no agent state names or plans); the draft's limitations appear once, in Limitations; a repeated "Cause" heading is dropped; the time column no longer wraps; clipped evidence ends with "…" |
| Report | XLSX summary labels and the ZIP caption were still Indonesian |
| UI | Capture final needs an environment as well as E3; when it is unavailable, Export is the primary action |
| CLI engine | Tool calls written outside the JSON envelope (`tool_call\n{"name": …, "input": …}`, several in a row) are recovered instead of turning into text; unknown tool names stay prose |
| Eval | With a CLI engine, cost and cache hit are reported as n/a (the numbers belong to the CLI session, not NSIC); a failed session prints its error |

**Live run** (fixture repo, no NetSuite access, `claude-code` engine): upload → root-caused E4 in about 4.5 minutes,
15 LLM calls, pointing at `ue_vb_approval.js` and `ue_vb_sync_ap.js`. The client PDF rendered through Chrome.
The CLI engine has no prompt caching and is slower per call; cost and cache gates need the Messages API engine.

**First eval** (3 seed cases, `claude-code`, Sonnet agent, Haiku triage/ingest): 3/3 passed at E4 with the expected
files; median 13 tool calls per session, median 8.2k input tokens per call, 134 to 442 s per case. The slow case lost a
tool call to a malformed CLI reply, which the recovery above now handles.

Still open for the MVP: S-02, S-03 and S-05 against a real sandbox (MCP OAuth, M2M SuiteQL, execution logs), which
decide whether E2 from live data works; and a real eval set of 10 to 20 historical issues.
