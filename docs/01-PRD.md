# 01 · Product Requirements Document — NSIC (NetSuite Issue Copilot)

## 1. Summary

NSIC is a **local, single-user** web application that acts as an "AI engineer companion" for a
NetSuite developer. You simply create an issue (title, description from the client, attachments). Once the
issue is submitted, an AI agent moves automatically: extracting facts from attachments, investigating
the repo and the NetSuite account based on available access, reproducing the issue, gathering evidence,
finding the root cause, (optionally) fixing and verifying it in sandbox, then producing
step-by-step screenshots, a video recording, and a PDF/XLSX report. You can chat with the agent inside
the issue at any time, and there's a separate chat for drafting concise answers to a consultant.

## 2. Problem

| # | Current problem | Impact |
|---|---|---|
| P1 | Client issues arrive in messy formats (email, screenshots, xlsx, pdf) | Time is spent understanding the problem instead of solving it |
| P2 | Access differs per client (admin, developer, restricted role, prod read-only) | Debugging workflow is inconsistent per project |
| P3 | Manual investigation: opening scripts, checking execution logs, finding deployments, checking workflows | Slow, and easy to miss another active script/workflow on the same record |
| P4 | Evidence is scattered (personal notes, screenshot folders, chat) | Hard to answer the consultant and build a report |
| P5 | Producing step-by-step screenshots and reproduce videos takes time | The internal team gets less visual evidence |
| P6 | AI cost is invisible per issue | Can't assess ROI or bill for effort |

## 3. Goals & non-goals

### Goals (v1)
- G1. From a new issue to an evidenced root-cause hypothesis (≥ E2) **with no manual intervention** for typical issues.
- G2. One shared workflow for every Access Tier (A, B, C, P); the agent automatically picks its strategy.
- G3. All evidence (queries, logs, code, screenshots, video) is stored per issue and can be exported.
- G4. Cost transparency: token counts and estimated cost per step, per session, per issue.
- G5. Consultant answers within seconds, concise, natural, and evidence-based.
- G6. Minimal dependencies: Bun 1.4 built-ins for nearly everything needed.

### Non-goals (v1)
- N1. Multi-user, team login, or cloud hosting.
- N2. Deploying to production by the agent. **Never**, in any version.
- N3. Replacing the client's issue tracker (Jira, etc.). NSIC is a personal workspace; external tracker integration is on the backlog.
- N4. Semantic/vector search in v1 (SQLite FTS5 + LLM rerank is enough).
- N5. Automating Claude Cowork from the backend (there's no API for that); Cowork is only a manual path + uploading results.

## 4. Personas & usage context

**Primary: you, a NetSuite developer / technical consultant.**
You handle several clients in parallel, each with their own sandbox and production, an SDF repo
(or sometimes no repo), and different access levels. You work on a laptop (macOS/Linux/Windows), often
over a client VPN connection.

**Secondary (does not log into the app): fellow consultants & the internal team.**
They receive output: the chat answer you copy over, the PDF/XLSX report, the MP4 video.

## 5. Core concepts

| Concept | Definition |
|---|---|
| Project | One client/implementation. Has ≥ 1 environment and 0..n repos |
| Environment | One NetSuite account (sandbox / production / release preview) + credentials + Access Profile |
| Access Profile | The result of a capability probe: tier A/B/C/P + a list of concrete capabilities |
| Issue | A unit of work: title, description, attachments, target environment, status, evidence level |
| Session | One agent run on an issue (auto run, a continuation after chat, capture, verify) |
| Evidence | A structured piece of evidence (query, log, file:line, screenshot, video) with a level E0-E5 |
| Repro Script | Reproduce steps in a deterministic DSL, replayable |
| Artifact | A generated file: screenshot, video, report, trace, export |

## 6. User stories

Format: *As a developer, I want ..., so that ...* with acceptance criteria (AC).

### Epic A · Onboarding & pairing
- **US-A1** I want to add a project and environment through a wizard, so that setting up a new account takes < 15 minutes.
  - AC: the wizard walks through which NetSuite features need to be enabled, creating the MCP role, the integration record, and the redirect URI.
  - AC: OAuth consent is done once through the browser; the token is stored encrypted and auto-refreshes.
- **US-A2** I want the app to automatically detect access capabilities (capability probe).
  - AC: the probe tests the MCP tools list, SuiteQL, REST record read, the SDF CLI, and the browser session; the result is stored as an Access Profile with a timestamp.
  - AC: the UI shows the tier and any missing capabilities along with how to enable them.
- **US-A3** I want to pair a repo (local path or git URL) and have the app index the SDF structure.
  - AC: the index contains scripts, deployments, record types, custom fields, workflows, saved searches, and entry points.
  - AC: incremental re-indexing based on file hash / `git diff`.
- **US-A4** I want to save a NetSuite browser login session (including 2FA/SSO) once, then have the runner reuse it.
  - AC: "Login Assist" opens Chrome with an environment-specific profile; once logged in, the runner reuses the session until it expires; expiration is detected and I'm notified.

### Epic B · Issue intake
- **US-B1** I want to create an issue with a title, description, target environment, priority, and attachments (drag & drop, paste screenshot).
  - AC: supported types: png/jpg/webp/gif, pdf, docx, xlsx, csv, txt, json, xml, js, eml (msg & xls via conversion, see doc 09).
  - AC: submitting immediately creates an ingestion job + auto-runs the agent (can be turned off per project).
- **US-B2** I want the agent to extract key entities from attachments.
  - AC: entities: transaction number/ID, internal ID, error message & code, timestamp, user, role, subsidiary, script ID, NetSuite URL.
  - AC: each entity has a source (file + page/line/sheet) and can be corrected manually.

### Epic C · Autonomous investigation
- **US-C1** I want the agent to automatically triage (category, severity, module area, environment) and build an investigation plan.
- **US-C2** I want the agent to use tools appropriate to the tier (MCP, SuiteQL, repo, logs, browser) without me picking manually.
  - AC: a tool unavailable at the current tier is never offered to the model.
- **US-C3** I want to see real-time progress: steps, tool calls, summarized results, tokens used.
  - AC: streamed via WebSocket; events appear < 1 second after they occur.
- **US-C4** I want the agent to stop at a checkpoint and ask when it needs a decision or access.
  - AC: status `awaiting_user` + a specific question; the agent continues once I answer in chat.
- **US-C5** I want a structured evidence board with levels E0-E5 and hypotheses with confidence levels.

### Epic D · Chat on an issue
- **US-D1** I want to chat with the agent inside an issue, with the evidence board as context rather than the raw transcript.
- **US-D2** I want to be able to direct actions from chat ("check the approval workflow", "reproduce using the AP Clerk role").
- **US-D3** I want to mark evidence as "confirmed" or "rejected" and have the agent adjust its hypotheses.

### Epic E · Reproduce, capture, recording
- **US-E1** I want the agent to compose a Repro Script from the investigation results and run it.
- **US-E2** Once an issue reaches ≥ E3, I want a final capture: a screenshot for each step with the element highlighted + a caption, stored per issue.
- **US-E3** I want a step-by-step video recording (MP4) with captions and redaction of sensitive data.
- **US-E4** After a fix, I want to replay the same script → "before" and "after" videos.
- **US-E5** In the production environment, the runner must never perform any write action.
  - AC: clicking a dangerous button or navigating into edit mode (`e=T`) is blocked and logged in the audit log.

### Epic F · Fix & verify (Tier A/B, sandbox only)
- **US-F1** I want the agent to create a branch, write a fix, and run unit tests and `suitecloud project:validate`.
- **US-F2** With my approval, the agent deploys to sandbox and then runs a verification replay.
  - AC: deployment only through an explicitly generated `deploy.xml` containing the affected objects.

### Epic G · Token usage & cost
- **US-G1** I want to see token counts (input, output, cache write, cache read) and cost per step, session, issue, project, and month.
- **US-G2** I want a budget per issue with an 80% warning and a 100% hard stop.

### Epic H · Consultant assistant
- **US-H1** I want a separate chat box for pasting in consultant questions and getting a concise, natural draft answer in English or another supported language.
  - AC: the answer is based only on the issue's evidence; if there's no evidence, it says so plainly.
  - AC: it never includes secrets, tokens, local paths, or notes marked private.
  - AC: a copy button, a tone choice (formal/casual), and a length choice (1 sentence / 1 paragraph).

### Epic I · Report & export
- **US-I1** Export a PDF report (summary, timeline, root cause, evidence + screenshots, reproduce steps, fix, verification status, optional token/cost).
- **US-I2** Export XLSX (sheets: Summary, Timeline, Evidence, Steps, Token Usage).
- **US-I3** Export an MP4 video and a zipped issue package (all artifacts).

### Epic J · Proactive monitoring (final phase)
- **US-J1** I want scheduled polling of execution log errors per environment that automatically creates a draft issue + an initial investigation.

## 7. Functional requirements

Priority: **P0** required for v1 · **P1** v1 if time allows · **P2** backlog.

| ID | Requirement | Priority | Ref |
|---|---|---|---|
| FR-01 | Project, environment, repo CRUD | P0 | 02, 04 |
| FR-02 | Per-environment onboarding wizard (MCP role, integration record, OAuth PKCE, M2M cert) | P0 | 06, 07 |
| FR-03 | Capability probe + Access Profile (A/B/C/P) | P0 | 06 |
| FR-04 | Encrypt all credentials at rest (AES-GCM) | P0 | 06 |
| FR-05 | SDF repo indexer + dependency graph + FTS | P0 | 07 |
| FR-06 | Issue CRUD + attachment upload (multi-file, paste image) | P0 | 09 |
| FR-07 | Ingestion pipeline per file type + entity extraction | P0 | 09 |
| FR-08 | Agent orchestrator (state machine, tool loop, checkpoint) | P0 | 05 |
| FR-09 | Tool registry filtered per tier & environment | P0 | 05, 06 |
| FR-10 | Evidence board E0-E5 | P0 | 05 |
| FR-11 | Streaming agent events via WebSocket | P0 | 13 |
| FR-12 | Issue chat (agent thread) with actions | P0 | 11 |
| FR-13 | Token usage per API call + aggregation + budget | P0 | 10 |
| FR-14 | Browser runner (Repro DSL) + per-step screenshots | P0 | 08 |
| FR-15 | Browser production guard | P0 | 08 |
| FR-16 | Login Assist + encrypted browser session storage | P0 | 08 |
| FR-17 | PDF report | P0 | 12 |
| FR-18 | XLSX report | P0 | 12 |
| FR-19 | Consultant assistant | P0 | 11 |
| FR-20 | Redaction of sensitive data in screenshots/video | P1 | 08 |
| FR-21 | MP4 screen recording + captions | P1 | 08 |
| FR-22 | Before/after fix replay | P1 | 08 |
| FR-23 | Fix + validate + deploy to sandbox (gated) | P1 | 07 |
| FR-24 | NetSuite error pattern library | P1 | 07 |
| FR-25 | Resolved-issue memory (FTS) + "similar issue" | P1 | 05 |
| FR-26 | Proactive execution log monitoring (`Bun.cron`) | P2 | 07 |
| FR-27 | Import/export issue package (.zip) | P2 | 12 |
| FR-28 | Jira/Linear/GitHub Issues integration | P2 | — |

## 8. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Deployment | One command: `bun install && bun run dev`. Bind to `127.0.0.1` only |
| NFR-02 | Dependencies | Runtime npm deps ≤ 3 packages; every addition requires an ADR |
| NFR-03 | Performance | Server cold start < 300 ms; UI interaction < 100 ms; listing 1,000 issues < 200 ms |
| NFR-04 | Resilience | Agent sessions are resumable after a crash/restart (per-step state in SQLite) |
| NFR-05 | Security | Secrets never enter the LLM context, logs, reports, or exports |
| NFR-06 | Security | Production is read-only at 2 layers (NetSuite role + application guard) |
| NFR-07 | Privacy | Client data sent to the LLM is minimized to what's needed; PII redacted in visual artifacts |
| NFR-08 | Audit | Every tool call, browser action, and credential access is logged in `audit_log` |
| NFR-09 | Portability | macOS, Linux, Windows |
| NFR-10 | Storage | All data under `./data` (SQLite + files); backup = folder snapshot |
| NFR-11 | Accessibility | WCAG AA, keyboard navigable, light by default with a user-chosen dark theme |
| NFR-12 | Observability | Structured JSONL logging per session; `bun --cpu-prof-md` for profiling |
| NFR-13 | Cost | Default per-issue budget is configurable; prompt caching is on |

## 9. Main flow (happy path)

1. Create an issue → upload attachments → Submit.
2. The `ingest` job processes attachments → entities + a per-file summary.
3. The `agent_session` job (auto mode): TRIAGE → INVESTIGATE → HYPOTHESIZE → REPRODUCE → ROOT_CAUSE.
4. The agent stops at a checkpoint (needs access/confirmation) or once it reaches the highest evidence level possible at that tier.
5. You review the evidence board, chat to steer it, confirm evidence.
6. Once ≥ E3, click **Capture final** → the runner replays the Repro Script: screenshots + video.
7. (Tier A/B) **Fix** → validate → approve sandbox deploy → **Verify** (replay "after").
8. **Export** PDF/XLSX/MP4; answer the consultant using the assistant.
9. The issue becomes `resolved` → goes into memory for the next similar issue.

## 10. Issue status

`draft → ingesting → investigating → awaiting_user ⇄ investigating → reproduced → root_caused → fixing → verifying → resolved → closed`

Side statuses: `blocked` (access/credentials), `budget_exceeded`, `cancelled`.

## 11. Success metrics

| Metric | 3-month usage target |
|---|---|
| Median time from issue to evidenced hypothesis (E2) | < 20 minutes |
| % of issues reaching E3 with no manual steps besides chat | ≥ 50% |
| LLM cost per issue | 100% tracked, median under the default budget |
| Time to draft a consultant answer | < 1 minute |
| Time to produce a report + video | < 5 minutes |
| Unintended write-action incidents in production | 0 |

## 12. Assumptions & constraints

- The Anthropic API is the default engine; Claude API, Claude Code, or Codex and their model profiles are selected in Settings (ADR-008). The Anthropic API key remains in `.env`.
- Chrome/Chromium is installed (needed for CDP: screencast, printToPDF). ffmpeg is installed for MP4.
- SuiteCloud CLI (+ Java matching its version requirement) is installed for tier A/B. This is a system dependency, not an app npm dependency.
- The client permits automation (API/MCP/UI) against their account. The wizard records this consent per environment.
