# NSIC — NetSuite Issue Copilot · PRD Package

Document version: 1.0 · Date: September 18, 2026 · Owner: you (single user, local-first)

NSIC is a local web app that helps a NetSuite developer investigate, reproduce,
fix, and report client issues in an AI-driven way, whether in sandbox or production
(read-only), regardless of the access level the client grants.

## How to read this package

| Order | File | Contents |
|---|---|---|
| 1 | `docs/01-PRD.md` | Main document: problem, goals, personas, user stories, functional & non-functional requirements, metrics |
| 2 | `docs/02-architecture.md` | System architecture, processes, folder structure, end-to-end flow |
| 3 | `docs/03-tech-stack-bun.md` | Mapping of requirements to Bun 1.4 built-in features, dependency budget |
| 4 | `docs/04-data-model.md` + `schema/schema.sql` | SQLite data model |
| 5 | `docs/05-agent-design.md` | Agent state machine, tools, evidence level, context & budget |
| 6 | `docs/06-access-profiles-security.md` | Access tiers, onboarding wizard, capability probe, security |
| 7 | `docs/07-netsuite-integration.md` | MCP (AI Connector Service), REST/SuiteQL, SDF/CLI, repo indexer |
| 8 | `docs/08-browser-capture-recording.md` | Browser runner, screenshots, redaction, screen recording, replay |
| 9 | `docs/09-attachment-ingestion.md` | Attachment pipeline (image, pdf, docx, xlsx, csv, email) |
| 10 | `docs/10-token-usage-cost.md` | Token usage & cost tracking per session |
| 11 | `docs/11-chat-consultant-assistant.md` | Issue chat & consultant answer assistant |
| 12 | `docs/12-reports-export.md` | PDF, XLSX, MD, MP4 export |
| 13 | `docs/13-api-spec.md` | HTTP routes & WebSocket events |
| 14 | `docs/14-ui-ux-spec.md` | Screens, components, UI state |
| 15 | `docs/15-roadmap.md` | Milestones, spikes, definition of done |
| 16 | `docs/16-risks-open-questions.md` | Risks, mitigations, open questions |
| 17 | `docs/17-best-practices.md` | Operational & engineering best practices |
| 18 | `docs/18-implementation-notes.md` | Spike results, PRD revisions, code status |
| — | `DESIGN.md` | NSIC design system (derived from Vercel design.md principles) |
| — | `AGENTS.md` | Instructions for the coding agent (Claude Code, etc.) building NSIC |
| — | `adr/` | Architecture Decision Records |
| — | `prompts/` | Draft agent, triage, and consultant system prompts |
| — | `config/` | Sample `.env`, `bunfig.toml`, `package.json`, pricing |
| — | `templates/` | HTML report template skeletons |

## Running it

```sh
bun install
bun run ui          # static UI prototype with sample data, no backend → http://127.0.0.1:4318
cp .env.example .env && bun run nsic   # fill in NSIC_MASTER_KEY; ANTHROPIC_API_KEY is only needed for Claude API
bun run dev         # full backend → http://127.0.0.1:4317
bun test && bun run typecheck
```

Choose Claude API, Claude Code, or Codex in **Settings → LLM engine and models**. For a development CLI, sign in with `claude` or `codex login` first. Switching engines fills the model inputs with that engine's saved values or defaults. New Codex profiles suggest GPT-5.6 Terra for main work and reports, Sol for escalation, and Luna for short tasks. Pick another suggested model or enter a model ID for any role. `default` lets Codex CLI choose a model (NSIC ignores user config for these calls); **Use suggested Codex models** replaces older all-default profiles when desired. Save to apply to new calls, including calls from workers, without restarting. CLI calls have no API cost estimate. The Anthropic API key remains in `.env` for Claude API mode.

Implementation status, spike results, and PRD revisions: `docs/18-implementation-notes.md`.

## Key decisions (summary)

1. **Bun 1.4.x only.** Server, bundler, test runner, SQLite, WebSocket, scheduler (`Bun.cron`),
   headless browser (`Bun.WebView`), image (`Bun.Image`), markdown (`Bun.markdown`), XML (`Bun.XML`),
   PTY (`Bun.Terminal`), shell (`Bun.$`), crypto (Web Crypto). The only runtime npm dependencies are `react` + `react-dom`.
2. **SQLite (`bun:sqlite`) + local filesystem** for all data and artifacts. FTS5 for search.
   No Redis, no Postgres, no vector DB in v1.
3. **Read-only production is enforced by the NetSuite role**, not by a prompt. The browser runner has a
   production guard as a second layer.
4. **The Administrator role cannot be used for the NetSuite MCP.** Admin is only for setup; the agent
   uses a dedicated MCP role.
5. **Reproduce = deterministic script (Repro DSL)**, not free-form clicking. The same script is replayed
   before and after the fix to produce before/after videos.
6. **Evidence levels E0–E5** measure how strong the evidence is; final capture only happens after ≥ E3.
7. **Design follows NSIC's DESIGN.md**, which adopts Vercel design.md principles (Geist, monochrome,
   evidence-led) without using Vercel's brand identity.

## External fact verification status

Facts about Bun 1.4, the NetSuite AI Connector Service, and Vercel design.md were checked on Sep 18, 2026.
Items not yet directly verified are marked **[SPIKE]** and scheduled in `docs/15-roadmap.md` (M0).
