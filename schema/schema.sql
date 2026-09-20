-- NSIC schema v1 · SQLite (bun:sqlite)
-- Conventions: id TEXT = UUIDv7, time = INTEGER epoch ms (UTC), JSON stored as TEXT (json_valid check)

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ───────────────────────── Settings & pricing ─────────────────────────
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL CHECK (json_valid(value)),
  updated_at  INTEGER NOT NULL
);

CREATE TABLE model_pricing (
  model               TEXT PRIMARY KEY,         -- e.g. 'claude-sonnet-5'
  input_per_mtok      REAL NOT NULL,            -- USD per 1 million tokens
  output_per_mtok     REAL NOT NULL,
  cache_write_per_mtok REAL NOT NULL,
  cache_read_per_mtok REAL NOT NULL,
  effective_from      INTEGER NOT NULL,
  note                TEXT
);

-- ───────────────────────── Projects & environments ─────────────────────────
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  client_name     TEXT,
  auto_run_agent  INTEGER NOT NULL DEFAULT 1,
  default_budget_usd REAL NOT NULL DEFAULT 3.0,
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  archived_at     INTEGER
);

CREATE TABLE environments (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                      -- 'SB1', 'Production'
  kind            TEXT NOT NULL CHECK (kind IN ('sandbox','production','release_preview','dev')),
  account_id      TEXT NOT NULL,                      -- '1234567_SB1'
  timezone        TEXT,                               -- account timezone (for logs)
  ui_base_url     TEXT,                               -- https://1234567-sb1.app.netsuite.com
  automation_consent_at INTEGER,                      -- client consent for automation
  created_at      INTEGER NOT NULL
);

CREATE TABLE access_profiles (
  id              TEXT PRIMARY KEY,
  environment_id  TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  tier            TEXT NOT NULL CHECK (tier IN ('A','B','C','P','none')),
  capabilities    TEXT NOT NULL CHECK (json_valid(capabilities)), -- {"mcp":true,"suiteql":true,...}
  mcp_tools       TEXT CHECK (mcp_tools IS NULL OR json_valid(mcp_tools)),
  role_name       TEXT,
  probed_at       INTEGER NOT NULL,
  probe_log       TEXT
);
CREATE INDEX idx_access_profiles_env ON access_profiles(environment_id, probed_at DESC);

-- Credentials are always encrypted (AES-GCM). Plaintext is never stored.
CREATE TABLE credentials (
  id              TEXT PRIMARY KEY,
  environment_id  TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN (
                    'mcp_oauth',          -- access/refresh token Authorization Code + PKCE
                    'rest_m2m',           -- client_id, certificate_id, private key
                    'sdf_auth_id',        -- suitecloud authId reference
                    'browser_session'     -- encrypted cookies/profile
                  )),
  label           TEXT,
  ciphertext      BLOB NOT NULL,
  iv              BLOB NOT NULL,
  key_version     INTEGER NOT NULL DEFAULT 1,
  expires_at      INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (environment_id, kind, label)
);

-- ───────────────────────── Repos & code index ─────────────────────────
CREATE TABLE repos (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('local_path','git_url')),
  location        TEXT NOT NULL,
  default_branch  TEXT,
  sdf_root        TEXT,                               -- folder containing manifest.xml
  project_type    TEXT CHECK (project_type IN ('ACCOUNTCUSTOMIZATION','SUITEAPP','NONE')),
  last_indexed_commit TEXT,
  last_indexed_at INTEGER
);

CREATE TABLE code_files (
  id              TEXT PRIMARY KEY,
  repo_id         TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  path            TEXT NOT NULL,
  sha256          TEXT NOT NULL,
  kind            TEXT NOT NULL,        -- 'suitescript','object_xml','other'
  script_type     TEXT,                 -- UserEventScript, ClientScript, MapReduceScript, ...
  api_version     TEXT,                 -- 2.0 / 2.1
  modules         TEXT,                 -- JSON array: ["N/record","N/search"]
  entry_points    TEXT,                 -- JSON array: ["beforeSubmit","afterSubmit"]
  size_bytes      INTEGER,
  UNIQUE (repo_id, path)
);

-- Objek SDF (script record, deployment, custom record, field, workflow, saved search, ...)
CREATE TABLE sdf_objects (
  id              TEXT PRIMARY KEY,
  repo_id         TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  scriptid        TEXT NOT NULL,        -- customscript_xxx, customdeploy_xxx, custbody_xxx
  object_type     TEXT NOT NULL,        -- usereventscript, scriptdeployment, customrecordtype, workflow, savedsearch, ...
  file_path       TEXT NOT NULL,
  attrs           TEXT NOT NULL CHECK (json_valid(attrs)), -- recordtype, status, loglevel, isdeployed, dll.
  UNIQUE (repo_id, scriptid)
);

-- Graph: edges between nodes (file/object/record type/field)
CREATE TABLE code_edges (
  repo_id         TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  src             TEXT NOT NULL,        -- 'obj:customscript_x' | 'file:/SuiteScripts/a.js' | 'rec:salesorder' | 'fld:custbody_x'
  dst             TEXT NOT NULL,
  rel             TEXT NOT NULL,        -- 'deploys','implements','applies_to','reads_field','writes_field','imports','triggers'
  PRIMARY KEY (repo_id, src, dst, rel)
);

CREATE VIRTUAL TABLE code_fts USING fts5(
  path, content, repo_id UNINDEXED, file_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- ───────────────────────── Issues ─────────────────────────
CREATE TABLE issues (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  environment_id  TEXT REFERENCES environments(id),
  key             TEXT NOT NULL UNIQUE,  -- 'ACME-42'
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  reporter        TEXT,                  -- client/consultant name
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status          TEXT NOT NULL DEFAULT 'draft',
  category        TEXT,                  -- triage result: bug, config, data, governance, integration, permission, enhancement
  severity        TEXT,
  module_area     TEXT,                  -- O2C, P2P, R2R, inventory, ...
  evidence_level  INTEGER NOT NULL DEFAULT 0 CHECK (evidence_level BETWEEN 0 AND 5),
  root_cause      TEXT,                  -- final summary (markdown)
  resolution      TEXT,
  budget_usd      REAL,                  -- override budget project
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  resolved_at     INTEGER
);
CREATE INDEX idx_issues_project_status ON issues(project_id, status, updated_at DESC);

CREATE VIRTUAL TABLE issues_fts USING fts5(
  title, description, root_cause, resolution, issue_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE attachments (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  storage_path    TEXT NOT NULL,         -- relative to data/
  source          TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','paste','email_child','cowork_import','agent')),
  parent_id       TEXT REFERENCES attachments(id), -- attachment inside an email
  ingest_status   TEXT NOT NULL DEFAULT 'pending' CHECK (ingest_status IN ('pending','running','done','failed','unsupported')),
  summary         TEXT,
  derived_text_path TEXT,
  meta            TEXT CHECK (meta IS NULL OR json_valid(meta)),
  created_at      INTEGER NOT NULL
);

CREATE TABLE entities (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,         -- transaction_no, internal_id, error_code, error_message, script_id, user, role, subsidiary, timestamp, url, record_type
  value           TEXT NOT NULL,
  normalized      TEXT,
  source_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  source_locator  TEXT,                  -- 'page 2', 'Sheet1!B14', 'line 33'
  confidence      REAL,
  status          TEXT NOT NULL DEFAULT 'auto' CHECK (status IN ('auto','confirmed','rejected','manual'))
);

-- ───────────────────────── Agent sessions ─────────────────────────
CREATE TABLE agent_sessions (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  trigger         TEXT NOT NULL CHECK (trigger IN ('auto','chat','capture','verify','fix','manual','monitor')),
  state           TEXT NOT NULL,         -- current state machine state
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','awaiting_user','done','failed','cancelled','budget_exceeded')),
  access_profile_id TEXT REFERENCES access_profiles(id),
  model_main      TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  error           TEXT
);
CREATE INDEX idx_sessions_issue ON agent_sessions(issue_id, started_at DESC);

CREATE TABLE agent_steps (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  state           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('llm','tool','checkpoint','transition','note')),
  title           TEXT,
  summary         TEXT,                  -- summary for the UI & context
  idempotency_key TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed','skipped')),
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  UNIQUE (session_id, seq)
);

CREATE TABLE tool_calls (
  id              TEXT PRIMARY KEY,
  step_id         TEXT NOT NULL REFERENCES agent_steps(id) ON DELETE CASCADE,
  tool            TEXT NOT NULL,
  risk            TEXT NOT NULL CHECK (risk IN ('read','local_write','remote_write_sandbox','blocked')),
  input           TEXT NOT NULL CHECK (json_valid(input)),
  output_path     TEXT,                  -- large output stored in a file
  output_preview  TEXT,
  ok              INTEGER,
  duration_ms     INTEGER,
  approved_by_user INTEGER NOT NULL DEFAULT 0
);

-- ───────────────────────── Evidence & hypotheses ─────────────────────────
CREATE TABLE evidence (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  session_id      TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
  level           INTEGER NOT NULL CHECK (level BETWEEN 0 AND 5),
  kind            TEXT NOT NULL,         -- client_report, suiteql_result, execution_log, code_ref, config_ref, screenshot, video, repro_run, test_result, deploy_result
  title           TEXT NOT NULL,
  body            TEXT,                  -- short markdown
  ref             TEXT CHECK (ref IS NULL OR json_valid(ref)), -- {"file":"...","line":33} | {"query":"..."} | {"artifact_id":"..."}
  status          TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','rejected')),
  private         INTEGER NOT NULL DEFAULT 0, -- must never reach the consultant/report
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_evidence_issue ON evidence(issue_id, level DESC);

CREATE TABLE hypotheses (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  statement       TEXT NOT NULL,
  confidence      REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','supported','refuted','accepted')),
  supporting      TEXT CHECK (supporting IS NULL OR json_valid(supporting)), -- evidence ids
  refuting        TEXT CHECK (refuting IS NULL OR json_valid(refuting)),
  updated_at      INTEGER NOT NULL
);

-- ───────────────────────── Chat ─────────────────────────
CREATE TABLE threads (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('agent','consultant')),
  created_at      INTEGER NOT NULL
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system_event')),
  content         TEXT NOT NULL,         -- markdown
  meta            TEXT CHECK (meta IS NULL OR json_valid(meta)), -- tone, language, cited evidence ids
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_messages_thread ON messages(thread_id, created_at);

-- ───────────────────────── Browser runs & artifacts ─────────────────────────
CREATE TABLE repro_scripts (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  environment_id  TEXT REFERENCES environments(id),
  dsl             TEXT NOT NULL CHECK (json_valid(dsl)),
  author          TEXT NOT NULL CHECK (author IN ('agent','user')),
  created_at      INTEGER NOT NULL,
  UNIQUE (issue_id, version)
);

CREATE TABLE browser_runs (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  repro_script_id TEXT REFERENCES repro_scripts(id),
  mode            TEXT NOT NULL CHECK (mode IN ('explore','reproduce','capture','verify_before','verify_after')),
  environment_id  TEXT NOT NULL REFERENCES environments(id),
  record_video    INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','passed','failed','blocked','cancelled')),
  result          TEXT CHECK (result IS NULL OR json_valid(result)), -- per-step status, detected errors
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER
);

CREATE TABLE artifacts (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  run_id          TEXT REFERENCES browser_runs(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('screenshot','video','captions','trace','report_pdf','report_xlsx','report_md','bundle_zip','diff','log')),
  step_index      INTEGER,
  caption         TEXT,
  storage_path    TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size_bytes      INTEGER,
  redacted        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_artifacts_issue ON artifacts(issue_id, kind, created_at);

-- ───────────────────────── Token usage ─────────────────────────
CREATE TABLE llm_calls (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT REFERENCES issues(id) ON DELETE SET NULL,
  session_id      TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
  step_id         TEXT REFERENCES agent_steps(id) ON DELETE SET NULL,
  purpose         TEXT NOT NULL CHECK (purpose IN ('ingest','triage','agent','consultant','report','summarize','probe','other')),
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,  -- computed from model_pricing at the time (snapshot)
  pricing_snapshot TEXT CHECK (pricing_snapshot IS NULL OR json_valid(pricing_snapshot)),
  latency_ms      INTEGER,
  stop_reason     TEXT,
  request_id      TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_llm_calls_issue ON llm_calls(issue_id, created_at);
CREATE INDEX idx_llm_calls_session ON llm_calls(session_id);

CREATE VIEW v_issue_usage AS
SELECT issue_id,
       COUNT(*)               AS calls,
       SUM(input_tokens)      AS input_tokens,
       SUM(output_tokens)     AS output_tokens,
       SUM(cache_write_tokens) AS cache_write_tokens,
       SUM(cache_read_tokens) AS cache_read_tokens,
       ROUND(SUM(cost_usd), 4) AS cost_usd
FROM llm_calls GROUP BY issue_id;

-- ───────────────────────── Jobs & audit ─────────────────────────
CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  payload         TEXT NOT NULL CHECK (json_valid(payload)),
  priority        INTEGER NOT NULL DEFAULT 5,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  lease_until     INTEGER,
  pid             INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_jobs_dispatch ON jobs(status, priority DESC, created_at);

CREATE TABLE audit_log (
  id              TEXT PRIMARY KEY,
  at              INTEGER NOT NULL,
  actor           TEXT NOT NULL CHECK (actor IN ('user','agent','system')),
  action          TEXT NOT NULL,         -- credential.decrypt, tool.call, browser.click, browser.blocked, sdf.deploy, export.create
  environment_id  TEXT,
  issue_id        TEXT,
  detail          TEXT CHECK (detail IS NULL OR json_valid(detail))
);
CREATE INDEX idx_audit_at ON audit_log(at DESC);

-- ───────────────────────── Resolved issue memory ─────────────────────────
CREATE TABLE issue_memory (
  issue_id        TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL,
  symptoms        TEXT NOT NULL,
  root_cause      TEXT NOT NULL,
  fix_summary     TEXT,
  files           TEXT,                  -- JSON array path
  error_codes     TEXT,                  -- JSON array
  created_at      INTEGER NOT NULL
);
CREATE VIRTUAL TABLE issue_memory_fts USING fts5(
  symptoms, root_cause, fix_summary, error_codes, issue_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

PRAGMA user_version = 1;
