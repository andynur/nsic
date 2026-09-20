# ADR-001 · Bun 1.4 as the sole runtime & toolkit

Status: Accepted · 2026-09-18

## Context
The app is local, single-user, and must be lightweight with minimal dependencies. Bun 1.4 provides server, bundler,
test runner, SQLite, WebSocket, cron, headless browser, image, markdown, and XML support, and PTY, all built in.

## Decision
The entire backend, frontend build, tests, and tooling use Bun 1.4.x. The only runtime npm deps are `react` + `react-dom`.

## Consequences
+ One toolchain, fast startup, small supply chain.
+ Some built-in modules are still new (WebView, cron): needs a spike (S-01) and a documented fallback.
- Some utilities are written in-house (zip, xlsx, eml, MCP client) and must be well tested.
