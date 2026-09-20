-- 002 · Issue keys per project, MCP URL per environment, report drafts, OAuth state.
ALTER TABLE projects ADD COLUMN key_prefix TEXT NOT NULL DEFAULT 'NS';
ALTER TABLE projects ADD COLUMN next_issue_seq INTEGER NOT NULL DEFAULT 1;
ALTER TABLE environments ADD COLUMN mcp_url TEXT;
ALTER TABLE environments ADD COLUMN monitor_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE environments ADD COLUMN last_polled_at INTEGER;
ALTER TABLE issues ADD COLUMN triage TEXT CHECK (triage IS NULL OR json_valid(triage));
ALTER TABLE issues ADD COLUMN questions_for_client TEXT CHECK (questions_for_client IS NULL OR json_valid(questions_for_client));

CREATE TABLE report_drafts (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  options         TEXT NOT NULL CHECK (json_valid(options)),   -- audience, includeCost, redactedOnly, formats
  model           TEXT NOT NULL CHECK (json_valid(model)),     -- ReportModel snapshot
  overrides       TEXT CHECK (overrides IS NULL OR json_valid(overrides)), -- edited narrative text
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  created_at      INTEGER NOT NULL,
  finalized_at    INTEGER
);
CREATE INDEX idx_report_drafts_issue ON report_drafts(issue_id, created_at DESC);

CREATE TABLE oauth_states (
  state           TEXT PRIMARY KEY,
  environment_id  TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  code_verifier   TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
