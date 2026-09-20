import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { redactSecrets } from "./redact-secrets.ts";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = (): Level => {
  const v = (process.env.LOG_LEVEL ?? "info") as Level;
  return v in ORDER ? v : "info";
};

function emit(level: Level, msg: string, fields?: Record<string, unknown>, file?: string) {
  if (ORDER[level] < ORDER[minLevel()]) return;
  const line = redactSecrets(JSON.stringify({ t: Date.now(), level, msg, ...fields }));
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line + "\n");
  }
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export type Logger = {
  debug(msg: string, f?: Record<string, unknown>): void;
  info(msg: string, f?: Record<string, unknown>): void;
  warn(msg: string, f?: Record<string, unknown>): void;
  error(msg: string, f?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>, file?: string): Logger;
};

export function createLogger(base: Record<string, unknown> = {}, file?: string): Logger {
  const mk = (level: Level) => (msg: string, f?: Record<string, unknown>) => emit(level, msg, { ...base, ...f }, file);
  return {
    debug: mk("debug"),
    info: mk("info"),
    warn: mk("warn"),
    error: mk("error"),
    child: (fields, childFile) => createLogger({ ...base, ...fields }, childFile ?? file),
  };
}

export const log = createLogger();
