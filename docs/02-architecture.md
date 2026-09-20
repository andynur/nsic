# 02 · System Architecture

## 1. Big picture

NSIC runs as **one Bun server process** + **worker processes** spawned per heavy job.
All state lives in SQLite (`data/nsic.db`, WAL mode) and the filesystem (`data/`).

```mermaid
flowchart TB
  subgraph Browser["Your browser (localhost)"]
    UI["React SPA<br/>(Bun HTML import)"]
  end
  subgraph Server["bun run src/server.ts (Bun.serve)"]
    API["HTTP routes /api/*"]
    WS["WebSocket /ws<br/>pub/sub per issue"]
    Q["Job queue (SQLite)"]
    CRON["Bun.cron<br/>token refresh, log polling, cleanup"]
  end
  subgraph Workers["Bun.spawn worker (per job)"]
    ING["Ingestion"]
    AG["Agent orchestrator"]
    BR["Browser runner<br/>Bun.WebView + CDP"]
    RP["Report builder"]
  end
  subgraph Local["Local resources"]
    DB[("SQLite<br/>nsic.db")]
    FS[("data/issues/*<br/>artifacts")]
    REPO[("SDF repo<br/>git")]
    CLI["suitecloud CLI<br/>via Bun.Terminal"]
    LLMCLI["Claude Code or Codex CLI<br/>development only"]
    FF["ffmpeg"]
  end
  subgraph External["External"]
    CLAUDE["Claude API<br/>/v1/messages"]
    MCP["NetSuite AI Connector<br/>(MCP)"]
    REST["NetSuite REST<br/>SuiteQL / Record"]
    NSUI["NetSuite UI"]
  end
  UI <--> API
  UI <--> WS
  API --> Q
  CRON --> Q
  Q --> Workers
  Workers --> DB
  Workers --> FS
  AG --> CLAUDE
  AG --> LLMCLI
  AG --> MCP
  AG --> REST
  AG --> REPO
  AG --> CLI
  BR --> NSUI
  BR --> FF
  Workers -- "event (IPC)" --> WS
```

## 2. Process model

| Process | Responsibility | Reason for separation |
|---|---|---|
| `server` | HTTP, WebSocket, queue dispatcher, `Bun.cron` | Must always stay responsive |
| `worker` (spawned per job) | ingestion, agent session, browser run, report | A crash/leak in one job doesn't take down the server; easy to kill (cancel) |

- Workers are spawned with `Bun.spawn(["bun", "src/worker.ts", jobId], { ipc })` and the `--no-orphans`
  flag so they die along with the server.
- Worker → server communication happens over **IPC** (`process.send`); the server forwards it to the
  WebSocket topic `issue:{id}` with `server.publish()`.
- Default concurrency: 2 agent workers + 1 browser worker (the browser is heavy and needs an exclusive session per environment).

## 3. Job queue in SQLite

The `jobs` table (see doc 04). The server-side dispatcher:

1. Every 500 ms (or on an internal `NOTIFY` after an insert), pick up the highest-priority `queued` job
   for which a slot of that type is available.
2. Set `status='running'`, `lease_until = now + 60s`, spawn a worker.
3. The worker updates a heartbeat every 15 seconds (extending `lease_until`).
4. On server startup: any `running` job with an expired lease goes back to `queued` (resuming from its last step).

Job types: `ingest`, `index_repo`, `probe_env`, `agent_session`, `browser_run`, `record_video`,
`build_report`, `sdf_deploy_sandbox`, `poll_logs`.

## 4. Application folder structure

```
nsic/
├─ package.json            # deps: react, react-dom
├─ bunfig.toml
├─ tsconfig.json
├─ .env                    # NSIC_MASTER_KEY, ANTHROPIC_API_KEY, PORT
├─ DESIGN.md
├─ AGENTS.md
├─ src/
│  ├─ server.ts            # Bun.serve: routes, websocket, static, HTML import
│  ├─ worker.ts            # worker entry point: dispatch per job type
│  ├─ config.ts
│  ├─ db/
│  │  ├─ schema.sql
│  │  ├─ migrate.ts        # PRAGMA user_version based
│  │  └─ repo/*.ts         # query functions per table (no ORM)
│  ├─ routes/              # /api/* handlers
│  ├─ realtime/            # topics, event types, IPC bridge
│  ├─ jobs/                # queue.ts, dispatcher.ts, cron.ts
│  ├─ llm/
│  │  ├─ anthropic.ts      # fetch /v1/messages, SSE parser, retry
│  │  ├─ cli.ts            # development Claude Code and Codex runners
│  │  ├─ usage.ts          # token & cost tracking
│  │  └─ cache.ts          # prompt caching strategy
│  ├─ agent/
│  │  ├─ orchestrator.ts   # state machine loop
│  │  ├─ states/*.ts       # triage, investigate, hypothesize, reproduce, ...
│  │  ├─ tools/*.ts        # tool registry + implementations
│  │  ├─ context.ts        # context assembly from the evidence board
│  │  ├─ evidence.ts
│  │  └─ budget.ts
│  ├─ netsuite/
│  │  ├─ oauth-pkce.ts     # Authorization Code + PKCE (MCP)
│  │  ├─ m2m-jwt.ts        # client credentials + JWT assertion (REST)
│  │  ├─ mcp-client.ts     # minimal Streamable HTTP JSON-RPC client
│  │  ├─ suiteql.ts
│  │  ├─ sdf.ts            # suitecloud CLI wrapper (Bun.Terminal / Bun.$)
│  │  └─ error-patterns.ts
│  ├─ repo/
│  │  ├─ git.ts            # Bun.$ git ...
│  │  ├─ indexer.ts
│  │  └─ sdf-parser.ts     # Bun.XML for Objects/*.xml, JSDoc tags for scripts
│  ├─ browser/
│  │  ├─ session.ts        # Bun.WebView lifecycle, profile, cookies via CDP
│  │  ├─ login-assist.ts
│  │  ├─ dsl.ts            # Repro DSL types & validation
│  │  ├─ runner.ts         # step execution, screenshot, highlight
│  │  ├─ guard.ts          # production guard
│  │  ├─ redact.ts
│  │  └─ recorder.ts       # CDP screencast → frames → ffmpeg
│  ├─ ingest/              # image.ts, pdf.ts, docx.ts, xlsx.ts, csv.ts, eml.ts, text.ts
│  ├─ reports/
│  │  ├─ model.ts          # ReportModel from the DB
│  │  ├─ html.ts           # render HTML (template + tokens.css)
│  │  ├─ pdf.ts            # CDP Page.printToPDF
│  │  └─ xlsx.ts           # minimal XLSX writer
│  └─ lib/
│     ├─ zip.ts            # ZIP reader/writer (deflate-raw + Bun.hash.crc32)
│     ├─ crypto.ts         # AES-GCM envelope
│     ├─ ids.ts            # Bun.randomUUIDv7
│     ├─ log.ts            # JSONL logger
│     └─ result.ts
├─ web/
│  ├─ index.html           # imported by the server (Bun HTML import)
│  ├─ main.tsx
│  ├─ app/                 # simple routing (URLPattern), pages, components
│  ├─ styles/
│  │  ├─ tokens.css        # generated from DESIGN.md
│  │  └─ app.css
│  └─ fonts/               # Geist Sans & Mono (OFL), self-hosted
├─ tests/                  # bun test
└─ data/                   # .gitignore
   ├─ nsic.db
   ├─ issues/{issueId}/
   │  ├─ attachments/
   │  ├─ derived/          # extracted text, thumbnails
   │  ├─ screenshots/{runId}/
   │  ├─ videos/{runId}/
   │  ├─ repro/            # repro script versions
   │  └─ reports/
   ├─ profiles/{envId}/    # per-environment Chrome profile (login assist)
   ├─ repos/{repoId}/      # clone if the repo comes from a URL
   └─ logs/{sessionId}.jsonl
```

## 5. End-to-end flow: a new issue

```mermaid
sequenceDiagram
  participant U as You
  participant S as Server
  participant W as Worker (ingest)
  participant A as Worker (agent)
  participant C as Claude API
  participant N as NetSuite (MCP/REST)
  U->>S: POST /api/issues (multipart)
  S->>S: save issue + file, enqueue ingest
  S-->>U: 201 + issueId
  U->>S: WS subscribe issue:{id}
  S->>W: spawn ingest
  W->>C: summarize + extract entities (Haiku)
  W-->>S: event ingest.done
  S->>A: spawn agent_session (auto)
  loop state machine
    A->>C: messages + tools (Sonnet)
    C-->>A: tool_use
    A->>N: MCP tools/call / SuiteQL
    N-->>A: result
    A-->>S: event step, evidence, usage
    S-->>U: WS push
  end
  A-->>S: checkpoint awaiting_user
  U->>S: POST chat message
  S->>A: resume session
```

## 6. Final capture & recording flow

```mermaid
sequenceDiagram
  participant U as You
  participant S as Server
  participant B as Worker (browser)
  participant NS as NetSuite UI
  U->>S: POST /api/issues/{id}/capture
  S->>B: spawn browser_run (mode=capture, record=true)
  B->>B: load env profile + guard + redaction
  B->>NS: navigate/click per the Repro DSL
  B->>B: per step: highlight → screenshot → caption
  B->>B: CDP screencast frames → ffmpeg → MP4 + VTT
  B-->>S: artifacts saved, event run.done
  S-->>U: WS push, gallery update
```

## 7. Architectural principles

1. **Deterministic at the edges, AI in the middle.** Parsing, the runner, the guard, and exports are written deterministically; the LLM only decides on steps and writes narrative.
2. **Light event sourcing.** Every agent step is stored as `agent_steps` + `tool_calls`; the UI is a projection of those tables.
3. **Idempotent & resumable.** Every step has an `idempotency_key`; a restarted worker resumes from the last step marked `done`.
4. **Least privilege per tool.** Tools declare `risk` and `allowedEnvKinds`; the registry filters before sending them to the model.
5. **Secrets never cross a boundary.** Credentials are decrypted only inside the `netsuite/*` module at request time, and are never put into a prompt or a log.
