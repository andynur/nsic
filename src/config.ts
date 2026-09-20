import { resolve } from "node:path";

/** Where LLM calls go: the Messages API (default) or a local CLI login for development (ADR-008). */
export type LlmEngine = "api" | "claude-code" | "codex";
export const LLM_ENGINES: LlmEngine[] = ["api", "claude-code", "codex"];

export type AppConfig = {
  port: number;
  host: string;
  dataDir: string;
  masterKeyB64: string | undefined;
  anthropicApiKey: string | undefined;
  anthropicBaseUrl: string;
  llmCliBin: string | undefined;
  llmCliTimeoutMs: number;
  chromePath: string | undefined;
  ffmpegPath: string | undefined;
  suitecloudPath: string | undefined;
  rootDir: string;
};

const blank = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : undefined);

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const rootDir = resolve(import.meta.dir, "..");
  return {
    port: Number(env.PORT ?? 4317),
    host: env.HOST ?? "127.0.0.1",
    dataDir: resolve(rootDir, env.DATA_DIR ?? "./data"),
    masterKeyB64: blank(env.NSIC_MASTER_KEY),
    anthropicApiKey: blank(env.ANTHROPIC_API_KEY),
    anthropicBaseUrl: blank(env.ANTHROPIC_BASE_URL) ?? "https://api.anthropic.com",
    llmCliBin: undefined,
    llmCliTimeoutMs: 10 * 60_000,
    chromePath: blank(env.CHROME_PATH),
    ffmpegPath: blank(env.FFMPEG_PATH),
    suitecloudPath: blank(env.SUITECLOUD_PATH),
    rootDir,
  };
}

let cached: AppConfig | undefined;
export const config = (): AppConfig => (cached ??= loadConfig());
export const setConfigForTest = (c: AppConfig) => {
  cached = c;
};
