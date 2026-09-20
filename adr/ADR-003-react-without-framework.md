# ADR-003 · React 19 via Bun's HTML import, no framework/UI kit

Status: Accepted · 2026-09-18

## Context
The UI is fairly complex (streaming timeline, chat, tables, gallery, report preview). Vanilla DOM would slow things down.

## Decision
React 19 + react-dom, bundled by `Bun.serve`'s HTML import. Routing with `URLPattern`, local state + a small
in-house store, plain CSS using `DESIGN.md` tokens. `Bun.markdown.react()` for markdown.

## Alternatives
Preact (smaller) — could be considered if bundle size becomes an issue. Next.js/Tailwind/shadcn were rejected (large dependencies, at odds with the minimalism goal).
