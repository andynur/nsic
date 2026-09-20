# 13 · API Spec (HTTP + WebSocket)

Base: `http://127.0.0.1:{PORT}`. JSON except for uploads (multipart) and downloads (binary).
Every mutation requires the `X-NSIC-CSRF` header. Error format: `{ "error": { "code": "...", "message": "...", "details"?: {} } }`.

## 1. Routes (`Bun.serve({ routes })`)

### Projects & environments
| Method | Path | Notes |
|---|---|---|
| GET | `/api/projects` | List |
| POST | `/api/projects` | Create |
| GET/PATCH/DELETE | `/api/projects/:id` | Detail/update/archive |
| POST | `/api/projects/:id/environments` | Add an environment |
| PATCH/DELETE | `/api/environments/:id` | Update/delete |
| POST | `/api/environments/:id/probe` | Enqueue a capability probe |
| GET | `/api/environments/:id/access-profile` | Latest profile + history |
| POST | `/api/environments/:id/oauth/start` | Start OAuth PKCE (MCP) → `{ authorizeUrl }` |
| GET | `/oauth/callback` | OAuth callback (a small HTML page: "success, close this tab") |
| POST | `/api/environments/:id/m2m/keypair` | Generate a key pair → `{ certificatePem }` |
| PUT | `/api/environments/:id/m2m` | Save the client id + certificate id |
| POST | `/api/environments/:id/login-assist/start` | Open Chrome with the env profile |
| POST | `/api/environments/:id/login-assist/finish` | Save the session |
| POST | `/api/environments/:id/terminal` | Open a PTY for `suitecloud account:setup` → `{ terminalId }` (streamed via WS) |

### Repos
| Method | Path | Notes |
|---|---|---|
| POST | `/api/projects/:id/repos` | Pair a repo (`local_path` / `git_url`) |
| POST | `/api/repos/:id/index` | Enqueue indexing |
| GET | `/api/repos/:id/graph?record=salesorder` | Automation per record type |
| GET | `/api/repos/:id/search?q=` | FTS |

### Issues
| Method | Path | Notes |
|---|---|---|
| GET | `/api/issues?project=&status=&q=` | List + FTS |
| POST | `/api/issues` | multipart: `title`, `description`, `projectId`, `environmentId`, `priority`, `files[]`, `autoRun` |
| GET | `/api/issues/:id` | Full detail (issue, entities, evidence, hypotheses, usage summary) |
| PATCH | `/api/issues/:id` | Update a field / status / budget |
| DELETE | `/api/issues/:id` | Delete + file cleanup |
| POST | `/api/issues/:id/attachments` | Add an attachment |
| GET | `/api/attachments/:id/raw` | Download the original |
| PATCH | `/api/entities/:id` | Confirm/reject/correct |
| PATCH | `/api/evidence/:id` | Update status/private |

### Agent & chat
| Method | Path | Notes |
|---|---|---|
| POST | `/api/issues/:id/sessions` | Start a session (`trigger`) |
| POST | `/api/sessions/:id/cancel` | Cancel |
| POST | `/api/sessions/:id/resume` | Continue (after budget/approval) |
| GET | `/api/sessions/:id/steps?after=seq` | Steps + tool calls |
| POST | `/api/approvals/:toolCallId` | `{ approve: boolean, note? }` (sandbox deploy) |
| GET | `/api/issues/:id/threads/:kind/messages` | `kind` = `agent` / `consultant`. A checkpoint message has `meta: { checkpoint: true, options[], state }`; a deploy checkpoint (`state` = `AWAIT_DEPLOY_APPROVAL`) also has `meta.approval: { toolCallId, branch?, files?[], objects?[], diff? }` (diff truncated to 20k chars) for the approval block (14 §4) |
| POST | `/api/issues/:id/threads/agent/messages` | Message to the agent |
| POST | `/api/issues/:id/threads/consultant/draft` | `{ question, language, tone, length, audience }` → a draft (streamed via WS) |

### Browser, capture, artifacts
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/issues/:id/repro-scripts` | List/save DSL versions |
| POST | `/api/issues/:id/runs` | `{ mode, reproScriptId, recordVideo }` |
| GET | `/api/runs/:id` | Status + per-step results |
| GET | `/api/issues/:id/artifacts?kind=` | List |
| GET | `/api/artifacts/:id/file` | Stream the file (Range supported, for video seeking) |

### Report & usage
| Method | Path | Notes |
|---|---|---|
| POST | `/api/issues/:id/reports` | `{ formats[], audience, includeCost, redactedOnly }` → a job |
| GET | `/api/issues/:id/reports/preview` | HTML preview |
| POST | `/api/reports/:id/finalize` | Finalize with the edited text |
| GET | `/api/usage?from=&to=&project=` | Aggregation |
| GET/PUT | `/api/settings/models` | Model per role |
| GET/PUT | `/api/settings/llm` | `{ engine: "api" \| "claude-code" \| "codex", profiles: { api, "claude-code", codex } }` on GET; PUT `{ engine, models }` saves the selected profile and active engine atomically. Each profile has model IDs for every role and `max_tokens` per role. New Codex profiles suggest GPT-5.6 Terra for the main agent and report writer, Sol for escalation, and Luna for short tasks. The `default` value lets the CLI choose a model; NSIC runs it with `--ignore-user-config`. |
| GET/PUT | `/api/settings/pricing` | `model_pricing` |

### Static
| Path | Handler |
|---|---|
| `/` and `/*` (SPA) | HTML import `web/index.html` |
| `/fonts/*` | `{ dir: "./web/fonts" }` |

## 2. WebSocket `/ws`

The client sends `{ "type": "subscribe", "topics": ["issue:<id>", "global"] }`.
The server sends events shaped as:

```ts
type WsEvent =
  | { type: "issue.updated"; issueId; patch }
  | { type: "ingest.progress"; issueId; attachmentId; status }
  | { type: "session.started" | "session.state" | "session.ended"; sessionId; issueId; state?; status? }
  | { type: "step.started" | "step.done"; sessionId; step: { id; seq; state; kind; title; summary } }
  | { type: "tool.call"; sessionId; stepId; tool; risk; inputPreview }
  | { type: "tool.result"; sessionId; stepId; ok; outputPreview; durationMs }
  | { type: "llm.delta"; sessionId; stepId; text }                    // streaming narrative
  | { type: "usage.updated"; issueId; sessionId; totals; budget }
  | { type: "usage.warning" | "usage.exceeded"; issueId; percent }
  | { type: "evidence.added" | "evidence.updated"; issueId; evidence }
  | { type: "checkpoint"; sessionId; question; options? }
  | { type: "approval.required"; toolCallId; summary; diff? }
  | { type: "run.step"; runId; index; status; screenshotArtifactId? }
  | { type: "run.done"; runId; status }
  | { type: "browser.blocked"; runId; reason; target }
  | { type: "consultant.delta" | "consultant.done"; issueId; messageId; text? }
  | { type: "terminal.data"; terminalId; data }
  | { type: "job.failed"; jobId; error };
```

Events are also persisted (step/tool/evidence), so a reconnecting UI just needs to call
`GET /api/sessions/:id/steps?after=<lastSeq>`.
