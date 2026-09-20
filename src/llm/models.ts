// Model profiles per engine (03 §6). Older 'models' settings seed Claude profiles.
import { getSetting, putSetting } from "../db/repo/settings.ts";
import { db } from "../db/db.ts";
import type { LlmEngine } from "../config.ts";

export type ModelRole = "agent_main" | "agent_escalation" | "ingest" | "triage" | "intent" | "consultant" | "report_writer";
export type ModelSettings = Record<ModelRole, string> & { max_tokens: Record<string, number> };

export const DEFAULT_MODELS: ModelSettings = {
  agent_main: "claude-sonnet-5",
  agent_escalation: "claude-opus-5",
  ingest: "claude-haiku-4-5",
  triage: "claude-haiku-4-5",
  intent: "claude-haiku-4-5",
  consultant: "claude-haiku-4-5",
  report_writer: "claude-sonnet-5",
  max_tokens: { agent_main: 16000, agent_escalation: 16000, ingest: 4000, triage: 4000, intent: 1000, consultant: 2000, report_writer: 8000 },
};

const CODEX_DEFAULTS: ModelSettings = {
  ...DEFAULT_MODELS,
  agent_main: "gpt-5.6-terra",
  agent_escalation: "gpt-5.6-sol",
  ingest: "gpt-5.6-luna",
  triage: "gpt-5.6-luna",
  intent: "gpt-5.6-luna",
  consultant: "gpt-5.6-luna",
  report_writer: "gpt-5.6-terra",
};

export const llmEngine = (): LlmEngine => getSetting<LlmEngine>("llm.engine", "api");
export const defaultModels = (engine: LlmEngine): ModelSettings => engine === "codex" ? CODEX_DEFAULTS : DEFAULT_MODELS;

export function modelSettings(engine: LlmEngine = llmEngine()): ModelSettings {
  const fallback = defaultModels(engine);
  const legacy = engine === "codex" ? {} : getSetting<Partial<ModelSettings>>("models", {});
  const s = getSetting<Partial<ModelSettings>>(`llm.models.${engine}`, legacy);
  return { ...fallback, ...s, max_tokens: { ...fallback.max_tokens, ...(s.max_tokens ?? {}) } };
}

export const llmSettings = () => ({ engine: llmEngine(), profiles: {
  api: modelSettings("api"),
  "claude-code": modelSettings("claude-code"),
  codex: modelSettings("codex"),
} });

export function saveLlmSettings(engine: LlmEngine, models: ModelSettings): void {
  db().transaction(() => {
    putSetting(`llm.models.${engine}`, models);
    putSetting("llm.engine", engine);
  })();
}

export const modelFor = (role: ModelRole): string => modelSettings()[role];
export const maxTokensFor = (role: ModelRole): number => modelSettings().max_tokens[role] ?? 4000;
export const saveModelSettings = (s: Partial<ModelSettings>) => putSetting(`llm.models.${llmEngine()}`, { ...modelSettings(), ...s });

/** Official prices (USD / 1 million tokens) as of Sep 18, 2026; cache write 5m = 1.25× input, cache read = 0.1× input. */
export const DEFAULT_PRICING = [
  { model: "claude-sonnet-5", input_per_mtok: 2, output_per_mtok: 10, cache_write_per_mtok: 2.5, cache_read_per_mtok: 0.2 },
  { model: "claude-opus-5", input_per_mtok: 5, output_per_mtok: 25, cache_write_per_mtok: 6.25, cache_read_per_mtok: 0.5 },
  { model: "claude-haiku-4-5", input_per_mtok: 1, output_per_mtok: 5, cache_write_per_mtok: 1.25, cache_read_per_mtok: 0.1 },
];
