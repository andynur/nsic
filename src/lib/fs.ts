import { mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { config } from "../config.ts";

/** Absolute path inside data/, rejecting traversal out of the data dir. */
export function dataPath(...parts: string[]): string {
  const base = config().dataDir;
  const p = resolve(base, ...parts);
  if (p !== base && !p.startsWith(base + sep)) throw new Error(`path outside the data dir: ${p}`);
  return p;
}

export const relData = (abs: string): string => relative(config().dataDir, abs).split(sep).join("/");

export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}

export async function writeData(rel: string, data: string | Uint8Array | Blob | ArrayBuffer): Promise<string> {
  const abs = dataPath(rel);
  ensureDir(dirname(abs));
  await Bun.write(abs, data);
  return abs;
}

export const issueDir = (issueId: string, ...sub: string[]) => join("issues", issueId, ...sub);

export function removeIssueDir(issueId: string) {
  const p = dataPath("issues", issueId);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/^\.+/, "").slice(0, 160) || "file";
}
