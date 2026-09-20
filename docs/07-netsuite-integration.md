# 07 · NetSuite Integration

## 1. Access paths

| Path | Auth | Used for | Module |
|---|---|---|---|
| MCP (AI Connector Service) | OAuth 2.0 Authorization Code + PKCE, per role | Records, reports, saved searches, SuiteQL via MCP tools | `mcp-client.ts`, `oauth-pkce.ts` |
| REST Web Services | OAuth 2.0 Client Credentials (M2M, certificate-based JWT assertion) | SuiteQL, record read, metadata | `m2m-jwt.ts`, `suiteql.ts` |
| SDF / SuiteCloud CLI | authId (browser or `account:setup:ci`) | Object import, validate, deploy to sandbox | `sdf.ts` |
| UI | Browser session (Login Assist) | Explore, reproduce, capture | `browser/*` |

## 2. Minimal MCP client

Transport is Streamable HTTP: `POST` JSON-RPC 2.0 to the MCP URL with the headers
`Authorization: Bearer <access_token>`, `Accept: application/json, text/event-stream`.
The response can be plain JSON or SSE; the same SSE parser used for the Anthropic client is reused here.

Implemented methods: `initialize`, `notifications/initialized`, `tools/list` (with `cursor`
pagination), `tools/call`. The session id from the `Mcp-Session-Id` header is stored per worker.

```ts
// sketch
export async function mcpCall(env: Env, method: string, params: unknown) {
  const token = await getMcpAccessToken(env);           // auto-refreshes when < 5 minutes remain
  const res = await fetch(env.mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
               authorization: `Bearer ${token}`, ...(sessionId && { "mcp-session-id": sessionId }) },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId(), method, params }),
  });
  return parseJsonOrSse(res);
}
```

Alternative considered: the Claude API's MCP connector feature (Anthropic's server calling MCP on our behalf).
Rejected for v1 because NSIC needs full local-side control over the tool allowlist, auditing, and the production guard.

## 3. OAuth 2.0 for MCP (Authorization Code + PKCE)

1. Generate a `code_verifier` (32 random bytes, base64url) and `code_challenge = base64url(SHA-256(verifier))`.
2. Open NetSuite's authorize URL (from the integration record's documentation) with `response_type=code`, `client_id`,
   `redirect_uri=http://127.0.0.1:{PORT}/oauth/callback`, a `scope` matching the AI Connector Service, `state`, `code_challenge`, `code_challenge_method=S256`.
3. The callback validates `state`, then exchanges `code` + `code_verifier` at the token endpoint.
4. Store the access + refresh token encrypted (`credentials.kind='mcp_oauth'`), and schedule a refresh via `Bun.cron`.
5. Environment & role selection happens on the NetSuite login screen; the wizard reminds you to pick the MCP role, not Administrator.

**[SPIKE S-02]** confirm the scope value, whether a `127.0.0.1` redirect is accepted by the integration record, and the refresh token's lifetime.

## 4. REST M2M + SuiteQL

- Token endpoint: `https://<accountid>.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`.
- `grant_type=client_credentials`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`,
  `client_assertion=<JWT>`; the JWT header carries `kid` = the certificate ID; signed with the private key via Web Crypto.
- SuiteQL: `POST /services/rest/query/v1/suiteql?limit=1000&offset=0` with header `Prefer: transient`, body `{ "q": "SELECT ..." }`.
- Guard: `SELECT`/`WITH` only, a default limit of 200 rows for the agent, with the full result written to a file.

**Execution log source [SPIKE S-05]:** check the account's Records Catalog to see whether script logs can be queried via SuiteQL.
If that's unavailable or limited, provide an **optional RESTlet helper** (`nsic_log_reader.js`, read-only, deployed
to sandbox by you) that searches script logs by script ID, level, and time range. For production,
the RESTlet is only installed if the client agrees.

## 5. SuiteCloud CLI (SDF)

| Need | Command | Execution |
|---|---|---|
| CI auth (M2M) | `suitecloud account:setup:ci` | Non-interactive `Bun.$` |
| Interactive auth | `suitecloud account:setup` | `Bun.Terminal` (PTY) shown in the UI |
| Pull objects from the account | `suitecloud object:import` / `object:list` | `Bun.$` |
| Pull script files | `suitecloud file:import` | `Bun.$` |
| Validate | `suitecloud project:validate --server` | `Bun.$`, output parsed |
| Deploy to sandbox | `suitecloud project:deploy` | `Bun.$`, **sandbox environments only** + approval |

Deploy safeguards:
1. The target environment must be `kind='sandbox'` (checked twice: registry + `sdf.ts`).
2. `deploy.xml` is regenerated to contain only the files/objects in the `nsic/{issueKey}` branch diff.
3. A `project:validate` dry run must pass.
4. Explicit UI approval shows the diff + the object list.

**Projects without a repo:** the agent can create a temporary SDF workspace at `data/repos/{envId}-import`
and then `object:import`/`file:import` the relevant objects (tier A/B) for analysis.

## 6. SDF repo indexer

Input: a folder containing `manifest.xml` (+ `deploy.xml`), `src/FileCabinet/SuiteScripts/**`, `src/Objects/**`.

| Source | Extraction | Result |
|---|---|---|
| SuiteScript `*.js` / `*.ts` | JSDoc tags `@NApiVersion`, `@NScriptType`, `@NModuleScope`; `define([...])` `N/*` modules; the returned entry-point function names; field access (`getValue({fieldId})`, `setValue`, `submitFields`) via regex | `code_files`, edges `imports`, `reads_field`, `writes_field` |
| `Objects/customscript_*.xml` | `Bun.XML.parse`: scriptfile, deployments (recordtype, status, loglevel, execute as role, audience) | `sdf_objects`, edges `implements`, `deploys`, `applies_to` |
| `Objects/customrecord_*.xml`, `custbody_*`, `custentity_*`, etc. | Field, type, source list | nodes `fld:`, `rec:` |
| `Objects/customworkflow_*.xml` | Record type, trigger, state, action (including custom action scripts) | edges `applies_to`, `triggers` |
| `Objects/customsearch_*.xml` | Record type, filters, columns | `sdf_objects` |
| All text | FTS5 | `code_fts` |

Incremental re-indexing: compare file `sha256` or `git diff --name-only last_indexed_commit..HEAD`.

## 7. Error pattern library (initial)

Stored as data (`src/netsuite/error-patterns.ts`), extendable from resolved issues.

| Code / symptom | Common cause | First investigation step |
|---|---|---|
| `SSS_USAGE_LIMIT_EXCEEDED` | Governance exhausted: `record.load`/`search` inside a loop | Find loops containing `record.load/save`; check the script type; consider a Map/Reduce |
| `SSS_TIME_LIMIT_EXCEEDED` | A synchronous process runs too long | Profile the iteration count; move to async |
| `RCRD_HAS_BEEN_CHANGED` | A race condition between scripts/UE/workflow | `get_record_automation` on the record; check for an afterSubmit that loads+saves the same record |
| `INVALID_FLD_VALUE` | Internal ID lists differ across environments, hardcoded values | Search for hardcoded IDs in code; compare the list in sandbox vs. prod |
| `USER_ERROR` from a script | Custom validation | Search for the error message in code (FTS) |
| `INSUFFICIENT_PERMISSION` | Deployment execution role / audience | Check `execute as role` and the user's role permissions |
| `SSS_MISSING_REQD_ARGUMENT` | An empty API parameter | Search for calls to the relevant module, null values from empty fields |
| `UNEXPECTED_ERROR` | Varies | Gather execution logs around the timestamp, system notes |
| A field doesn't appear/save | Form, field-level permission, client script, sourcing | Check the form, `displayType`, client script `fieldChanged/postSourcing` |
| Workflow doesn't run | Entry condition, context, init trigger | Check the workflow XML: trigger, conditions, context types |

## 8. Proactive monitoring (final phase)

`Bun.cron("*/30 * * * *", pollLogs, { tz: env.timezone })` per enabled environment:
1. Fetch error logs since `last_polled_at` (same log source as §4).
2. Group by script + error code + normalized message (hash).
3. A new group or a spike (> N per hour) → draft an issue with entities filled in, auto-run TRIAGE only (cost-saving).
4. Notify in the UI (and optionally via an OS notification).
