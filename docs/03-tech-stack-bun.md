# 03 · Tech Stack: Bun 1.4 First

Target runtime: **Bun 1.4.x** (1.4.2 at the time of writing). Bun 1.4 is Bun's first release
rewritten in Rust, and it adds many built-in modules that previously required an npm package:
`Bun.Image`, `Bun.WebView`, `Bun.markdown`, `Bun.cron()`, `Bun.Terminal`, `Bun.XML`, `Bun.Archive`,
plus static directory serving in `Bun.serve` routes. NSIC's principle: **use the built-in first; reach for npm only when no built-in exists.**

## 1. Requirement → built-in mapping

| Need | Solution | Notes |
|---|---|---|
| HTTP server + routing | `Bun.serve({ routes })` | Route params, method handlers, static `{ dir }` |
| Frontend bundling + HMR | HTML import (`import index from "../web/index.html"`) | Bun bundles TSX/CSS automatically, dev HMR |
| Realtime | WebSocket in `Bun.serve` + `server.publish(topic)` | Topics `issue:{id}`, `global` |
| Database | `bun:sqlite` | WAL, `strict: true`, prepared statement cache, FTS5 |
| Migrations | `PRAGMA user_version` + `.sql` files | No ORM |
| Job scheduler | `Bun.cron(schedule, fn, { tz })` in-process | Token refresh, log polling, cleanup |
| Worker isolation | `Bun.spawn` + IPC, `--no-orphans` | 1 process per heavy job |
| Shell / git | `Bun.$` | `git clone/pull/diff/checkout`, non-interactive `suitecloud` commands |
| Interactive PTY | `Bun.Terminal` (the `terminal` option on `Bun.spawn`) | Interactive `suitecloud account:setup`, shown in the UI |
| Headless browser | `Bun.WebView` (Chrome backend) + `.cdp()` | Navigate, click, evaluate, screenshot; CDP for screencast, cookies, printToPDF |
| Image | `Bun.Image` | Thumbnails, resizing before sending to the model, conversion to WebP |
| Markdown | `Bun.markdown.react()` / `.render()` | Output is **not** sanitized, see §4 |
| XML | `Bun.XML.parse()` | SDF `Objects/*.xml`, DOCX/XLSX contents |
| JSONL | `Bun.JSONL` | Session logs, event export |
| Hash / CRC | `Bun.hash.crc32`, `Bun.CryptoHasher` | ZIP writer, attachment dedup (sha256) |
| Encryption | Web Crypto `crypto.subtle` (AES-GCM, HKDF) | Credential envelope encryption |
| JWT signing | Web Crypto (PS256/RS256/ES256) | NetSuite M2M client assertion |
| Local password | `Bun.password` | Optional app passcode |
| Compression | `CompressionStream` / `DecompressionStream` (`deflate-raw`) | Foundation for the ZIP reader/writer |
| ID | `Bun.randomUUIDv7()` | Sortable by time |
| Dates | `Temporal` (enabled by default in 1.4) | NetSuite account timezone vs. local |
| SPA URL routing | `URLPattern` | Frontend router with no library |
| Testing | `bun test --parallel`, `--changed` | Unit + integration |
| Profiling | `bun --cpu-prof-md`, `--heap-prof-md` | Markdown output |
| Single-binary build (optional) | `bun build --compile --asset web/dist` | Distribution to another laptop |

## 2. What has no built-in, and the decision made

| Need | Decision | Alternative if needed |
|---|---|---|
| UI framework | `react` + `react-dom` (the only runtime deps) | Preact (smaller) if a lighter footprint is wanted |
| ZIP (reading DOCX/XLSX, writing XLSX/packages) | Write `src/lib/zip.ts` (~250 LOC) with `deflate-raw` + `Bun.hash.crc32` | `fflate` (zero-dep) |
| XLSX writer | `src/reports/xlsx.ts` (minimal SpreadsheetML on top of `zip.ts`) | `write-excel-file` |
| EML parsing | A minimal MIME parser, `src/ingest/eml.ts` (multipart, base64, quoted-printable, RFC 2047) | `postal-mime` (zero-dep) |
| MSG (Outlook) | Not natively supported in v1; the UI asks the user to "Save as .eml" | `@kenjiuno/msgreader` (ADR) |
| XLS (legacy binary) | Not natively supported; ask the user to save as XLSX/CSV | — |
| PDF parsing | **Not needed**: PDFs are sent directly to Claude as a document block | — |
| PDF generation | CDP `Page.printToPDF` via `Bun.WebView`'s Chrome backend | Playwright `page.pdf()` |
| Video encoding | `ffmpeg` (system binary) | — |
| MCP client | A minimal `src/netsuite/mcp-client.ts` (JSON-RPC via Streamable HTTP) | `@modelcontextprotocol/sdk` |
| Anthropic client | `fetch` + a hand-written SSE parser (`src/llm/anthropic.ts`) | `@anthropic-ai/sdk` |
| Dev LLM engine (Claude Code or Codex selected in Settings) | Local CLI via `Bun.spawn` (`src/llm/cli.ts`, ADR-008) | Agent SDK |
| Vector search | Not in v1 (FTS5 + LLM rerank) | Embedding BLOB + brute-force cosine |

## 3. Dependency budget

```jsonc
// package.json (abridged; see config/package.json)
"dependencies": {
  "react": "^19",
  "react-dom": "^19"
},
"devDependencies": {
  "@types/bun": "latest",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  "typescript": "^7"
}
```

**System dependencies (not npm):**

| Binary | Used for | Required by milestone |
|---|---|---|
| `git` | Repo pairing, fix branches | M1 |
| Chrome / Chromium / Edge | `Bun.WebView`'s CDP backend | M4 |
| `ffmpeg` | MP4 + captions | M6 |
| `suitecloud` CLI + Java | SDF validate/deploy, object import | M6 (tier A/B) |

Rule: every new npm dependency requires an ADR in `adr/` stating the reason, size, number of
transitive deps, and an exit plan. Run `bun pm licenses --prod` and `bun audit` in local CI.

## 4. Important notes per built-in

- **`Bun.markdown` does not sanitize HTML.** LLM output can contain HTML from a client attachment
  (prompt injection → XSS). Use `Bun.markdown.react()` with component overrides that
  drop raw HTML nodes, or `render()` with an `html` handler that returns an empty string.
  Never `dangerouslySetInnerHTML` the output of `Bun.markdown.html()` without sanitizing it first.
- **`Bun.WebView`**: on macOS it defaults to the system WebKit; NSIC **forces the Chrome backend** because it needs CDP
  (screencast, cookies, printToPDF, network events). **[SPIKE S-01]** to verify: backend selection option,
  persistent profile/user-data-dir support, non-headless mode for Login Assist, file upload, multi-tab.
  Official fallback: Playwright (already working on Bun 1.4) as an optional dependency via ADR-004.
- **`Bun.WebView` is headless only** (per spike S-01 findings): Login Assist runs Chrome headed via `Bun.spawn` with `--user-data-dir` pointing at the env profile.
- **`Bun.XML`** groups repeated tags, which loses mixed-content ordering; used for SDF objects, while DOCX/XLSX use a sequential tokenizer instead.
- **CSS in HTML imports**: `url()` must be relative (`../fonts/Geist-Regular.woff2`) so it gets bundled.
- **`Bun.cron`** in-process uses local time as of 1.4; always set `{ tz }` explicitly for jobs tied to the NetSuite account's timezone.
- **`bun:sqlite`**: in 1.4, `db.close()` finalizes every `db.query()` statement; only close the DB on shutdown.
- **Env file**: Bun loads `.env` automatically under `bun run`. Don't run the app through `node`-compat mode, since `.env` won't be loaded.

## 5. Base configuration

`bunfig.toml`:

```toml
[install]
linker = "isolated"
exact = true

[test]
coverage = false
```

`tsconfig.json` uses `"types": ["bun"]`, `"jsx": "react-jsx"`, `"strict": true`,
`"noUncheckedIndexedAccess": true`, `"verbatimModuleSyntax": true`.

## 6. AI models (configurable)

| Role | Default model | Reason |
|---|---|---|
| Main agent (investigation, tool use) | `claude-sonnet-5` | Good quality/cost balance for long loops |
| Escalation for hard root causes / fix review | `claude-opus-5` | Used only when the agent requests escalation or you choose "deep mode" |
| Ingestion, triage, summaries, consultant | `claude-haiku-4-5` | Fast and cheap for structured tasks |

Model names and per-million-token pricing are stored in the `model_pricing` table and can be changed in Settings.
Always check the latest model list and pricing in the official Anthropic documentation before filling it in.
