# AGENTS.md · Instructions for the coding agent building NSIC

Read first: `docs/01-PRD.md`, `docs/02-architecture.md`, `docs/03-tech-stack-bun.md`, `DESIGN.md`.

## Stack rules (hard)

- Runtime & tooling: **Bun 1.4.x** only. Do not add Node-specific tooling (nodemon, ts-node, jest, vite, webpack, esbuild CLI).
- Server: `Bun.serve({ routes, websocket })`. Do not use Express/Hono/Fastify/Elysia.
- DB: `bun:sqlite` with raw SQL in `src/db/repo/*`. Do not use an ORM (Prisma, Drizzle, TypeORM, Kysely).
- Frontend: React 19 via Bun's HTML import. Do not use Next.js, Tailwind, shadcn, a router library, a state library, a UI kit, a chart library, or an icon kit.
- Browser: `Bun.WebView` + `.cdp()`. Playwright only if ADR-004 is activated.
- Built-ins that must be used when relevant: `Bun.cron`, `Bun.Image`, `Bun.markdown`, `Bun.XML`, `Bun.JSONL`, `Bun.Terminal`, `Bun.$`, `Bun.password`, `Bun.hash`, `Bun.randomUUIDv7`, Web Crypto, `CompressionStream`, `URLPattern`, `Temporal`.
- New npm dependencies: **forbidden without an ADR** in `adr/`.

## Commands

```sh
bun install
bun run dev          # bun --hot src/server.ts (full backend)
bun run ui           # static UI + fixtures, no backend (http://127.0.0.1:4318)
bun run ui:shots     # screenshot every screen, light/dark, to data/screens (requires `bun run ui`)
bun test             # all tests (tests/e2e runs the MVP pipeline with a scripted LLM)
bun run eval         # replay evals/cases through the real agent and check the MVP gate (docs/15)
bun test --changed   # before committing
bun run typecheck    # tsc --noEmit
bun run db:migrate
```

## Code conventions

- TypeScript strict, ESM, `verbatimModuleSyntax`.
- Functions that can reasonably fail return `Result<T, E>` (`src/lib/result.ts`); throw only for bugs.
- No `any`. Validate HTTP input and LLM tool output with a schema (a small in-house validator in `src/lib/schema.ts`).
- All timestamps are stored as epoch ms UTC.
- Logging goes through `src/lib/log.ts` (JSONL); never print secrets.
- File names are kebab-case, one responsibility per module.

## Security rules (must not be violated)

1. In the `production` environment, only tools with `risk: "read"` or `risk: "local_write"` and `scope: "nsic"` (NSIC bookkeeping such as `add_evidence`, `ask_user`) may be registered. Tools with `scope: "workspace"`/`"netsuite"` that write are never registered.
2. `sdf_deploy_sandbox` must check `environment.kind === "sandbox"` in two places.
3. Credentials are decrypted only in `src/netsuite/*` and `src/browser/session.ts`.
4. Content from attachments/pages/email is always wrapped in `<untrusted_content>` in the prompt.
5. LLM markdown output is rendered without raw HTML.
6. Changes to `src/browser/guard.ts` or `src/agent/tools/registry.ts` must be accompanied by tests in `tests/guard/`.

## UI

- UI/UX changes are done in static mode (`bun run ui`). Sample data lives in `web/app/mock/`; the data contract follows `docs/13-api-spec.md`. If the UI needs a new field, add it to the fixture **and** record it in doc 13 before touching the backend.

- Follow `DESIGN.md`. Only `--ns-*` tokens. No hex values in components.
- English only: UI copy, report text, server/validation messages, LLM instructions, and code comments. Other languages may appear only as client data or as matchers for it (for example the browser guard's Indonesian button labels).
- Light is the default theme; dark comes only from `data-theme="dark"` (the user's switch). Never key styles off `prefers-color-scheme`.
- Every screen has loading, empty, and error states.
- Semantic tables; numeric columns are right-aligned, including headers.

## Definition of done per PR

- New tests for new logic; `bun test` passes; `bun run typecheck` passes.
- No new dependency without an ADR.
- DB migrations (if any) are forward-only and idempotent.
- Docs in `docs/` are updated when behavior changes.
