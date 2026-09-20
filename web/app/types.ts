// API response types used by the UI (subset).
export type Project = { id: string; name: string; client_name: string | null; key_prefix: string; auto_run_agent: boolean; default_budget_usd: number; notes: string | null; created_at: number; archived_at: number | null };
export type Env = { id: string; project_id: string; name: string; kind: string; account_id: string; timezone: string | null; ui_base_url: string | null; mcp_url: string | null; automation_consent_at: number | null; monitor_enabled: boolean; created_at: number; tier?: string };
export type AccessProfile = { id: string; tier: string; capabilities: Record<string, boolean>; mcp_tools: string[] | null; probed_at: number; probe_log: string | null };
export type EnvView = Env & { profile: AccessProfile | null; credentials: { kind: string; updated_at: number; expires_at: number | null }[]; capabilityTable: { name: string; available: boolean; hint: string }[] };
export type Repo = { id: string; source: string; location: string; sdf_root: string | null; project_type: string | null; last_indexed_at: number | null; last_indexed_commit: string | null; stats?: { files: number; objects: number; edges: number } };
export type ProjectListItem = Project & { environments: Env[]; repos: Repo[] };
export type ProjectDetail = Project & { environments: EnvView[]; repos: Repo[] };
export type Issue = { id: string; project_id: string; environment_id: string | null; key: string; title: string; description: string; reporter: string | null; priority: string; status: string; category: string | null; severity: string | null; module_area: string | null; evidence_level: number; root_cause: string | null; resolution: string | null; budget_usd: number | null; triage: { plan: string[]; missing_info: string[]; suspected_record_types: string[] } | null; questions_for_client: string[] | null; created_at: number; updated_at: number };
export type IssueRow = Issue & { project_name: string; env_name: string | null; env_kind: string | null; cost_usd: number | null; session_state: string | null };
export type Entity = { id: string; type: string; value: string; normalized: string | null; source_locator: string | null; confidence: number | null; status: string };
export type Attachment = { id: string; filename: string; mime: string; size_bytes: number; ingest_status: string; summary: string | null; source: string; parent_id: string | null; meta: Record<string, unknown> | null };
export type Evidence = { id: string; seq: number; level: number; kind: string; title: string; body: string | null; ref: Record<string, unknown> | null; status: string; private: boolean; created_at: number };
export type Hypothesis = { id: string; statement: string; confidence: number; status: string };
export type Session = { id: string; trigger: string; state: string; status: string; model_main: string; started_at: number; ended_at: number | null; error: string | null };
export type Artifact = { id: string; run_id: string | null; kind: string; step_index: number | null; caption: string | null; storage_path: string; mime: string; size_bytes: number | null; redacted: boolean; created_at: number };
export type Run = { id: string; mode: string; status: string; started_at: number; ended_at: number | null; result: { steps?: { index: number; id: string; action: string; status: string; caption?: string; note?: string; screenshotArtifactId?: string }[]; blocked?: { reason: string; target: string }[]; video?: { artifactId?: string; captionsArtifactId?: string; reason?: string } } | null };
export type ReproScript = { id: string; version: number; dsl: unknown; author: string; created_at: number };
export type Totals = { calls: number; input_tokens: number; output_tokens: number; cache_write_tokens: number; cache_read_tokens: number; cost_usd: number };
export type AuditEntry = { id: string; at: number; action: string; detail: Record<string, unknown> | null };
export type IssueDetail = {
  issue: Issue; rootCauseHtml: string | null; project: Project; environment: (Env & { tier: string; capabilities: Record<string, boolean> }) | null;
  entities: Entity[]; attachments: Attachment[]; evidence: Evidence[]; hypotheses: Hypothesis[]; sessions: Session[]; activeSession: Session | null;
  usage: { totals: Totals; byPurpose: (Totals & { purpose: string })[]; budget: number; cacheHitRatio: number };
  artifacts: Artifact[]; runs: Run[]; reproScripts: ReproScript[]; blocked: AuditEntry[];
};
export type Step = { id: string; seq: number; state: string; kind: string; title: string | null; summary: string | null; status: string; started_at: number; ended_at: number | null; usage: Totals | null; toolCalls: { id: string; tool: string; risk: string; input: unknown; output_preview: string | null; ok: boolean | null; duration_ms: number | null }[] };
export type Message = { id: string; role: string; content: string; html: string; meta: Record<string, unknown> | null; created_at: number };
