# NSIC — NetSuite Issue Copilot

NSIC is a local web application for investigating NetSuite issues, organizing evidence, and preparing reports. It combines attachment ingestion, an SDF repository index, an investigation agent, and optional NetSuite connections. Production investigations are read-only; sandbox workflows can use additional capabilities when configured.

The project is under active development. The repository and attachment investigation path has automated coverage. Live NetSuite OAuth, SuiteQL, and execution-log access still need validation against a real sandbox. See [implementation notes](docs/18-implementation-notes.md) and the [MVP scope](docs/15-roadmap.md).

## Requirements

- Bun 1.4.x (runtime, package manager, test runner, and bundler)
- Git
- An LLM connection for agent features: an Anthropic API key, or a signed-in Claude Code or Codex CLI
- Chrome or Chromium for browser capture and PDF export; `ffmpeg` for video; SuiteCloud CLI for SDF operations

The optional binaries are checked by `bun run system:check`. The static UI needs none of the LLM or NetSuite setup.

## Quick start

```sh
bun install
bun run nsic init
bun run dev
```

Open <http://127.0.0.1:4317>. `init` creates `.env` from `.env.example` if needed, generates `NSIC_MASTER_KEY`, and initializes the SQLite database under `data/`. Keep `.env` private and back up the master key separately from `data/`; encrypted credentials depend on it.

Choose **Claude API**, **Claude Code**, or **Codex** in **Settings → LLM engine and models**. For the API engine, set `ANTHROPIC_API_KEY` in `.env`. For a CLI engine, sign in to that CLI first. Model choices are saved per engine and apply to subsequent calls. CLI calls do not have an API cost estimate in NSIC.

For UI work without the backend, run:

```sh
bun run ui
```

Open <http://127.0.0.1:4318>. This mode uses fixtures in `web/app/mock/` and does not start the database, jobs, LLM, or NetSuite connections.

## Development commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the full server with hot reload |
| `bun run ui` | Start the fixture-backed static UI |
| `bun run ui:shots` | Capture light and dark screenshots in `data/screens/` while `bun run ui` is running |
| `bun run system:check` | Check the local runtime, binaries, LLM setup, and master key |
| `bun run db:migrate` | Apply forward-only SQLite migrations (also applied when the database opens) |
| `bun run db:seed-demo` | Replace the seed script's demo projects and issues in the selected database |
| `bun test` | Run unit, guard, and scripted end-to-end tests |
| `bun test --changed` | Run tests affected by local changes before committing |
| `bun run typecheck` | Run strict TypeScript checking |
| `bun run eval` | Replay cases in `evals/cases/` through the configured agent; requires an LLM connection |

`bun run eval` writes results under `data/evals/`. Its three included cases exercise the fixture repository; the [MVP gate](docs/15-roadmap.md) calls for 10–20 historical issues. To preview the backend UI with sample data, run `bun run db:seed-demo` against a disposable `DATA_DIR` because it replaces its own demo records.

## Project map

| Path | Responsibility |
| --- | --- |
| `src/server.ts`, `src/routes/` | Bun HTTP and WebSocket server, API routes |
| `src/db/` | SQLite migrations and raw-SQL repositories |
| `src/agent/`, `src/llm/` | Investigation flow, tool policy, model engines |
| `src/netsuite/`, `src/browser/` | NetSuite access and guarded browser workflows |
| `src/ingest/`, `src/repo/` | Attachment extraction and SDF repository indexing |
| `src/jobs/`, `src/reports/`, `src/eval/` | Background work, exports, and evaluation |
| `web/` | React 19 UI, static fixtures, styles, and screenshot tooling |
| `tests/`, `evals/` | Automated tests, fixtures, and agent cases |

## Contributing

Read [AGENTS.md](AGENTS.md) for the stack, security, UI, and definition-of-done rules. Use Bun 1.4.x, `Bun.serve`, `bun:sqlite` with raw SQL, and React without a framework or UI kit. New npm dependencies require an ADR in [`adr/`](adr/). Keep UI copy, reports, validation messages, and code comments in English.

For UI changes, work in static mode first. If the UI needs a new API field, update the fixture and [API specification](docs/13-api-spec.md) before changing the backend. Add tests for new logic, then run `bun test` and `bun run typecheck`. Changes to the browser guard or agent tool registry also need tests in `tests/guard/`.

## Documentation

- [Product requirements](docs/01-PRD.md), [architecture](docs/02-architecture.md), and [Bun stack](docs/03-tech-stack-bun.md)
- [API contract](docs/13-api-spec.md), [UI specification](docs/14-ui-ux-spec.md), and [design system](DESIGN.md)
- [Security and access profiles](docs/06-access-profiles-security.md), [roadmap](docs/15-roadmap.md), and [implementation notes](docs/18-implementation-notes.md)
- [Architecture decisions](adr/) and [agent instructions](AGENTS.md)
