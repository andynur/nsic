// Embedded terminal (PTY) for interactive `suitecloud account:setup` (06 §3 step 6, Bun.Terminal).
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { dataPath } from "../lib/fs.ts";
import { newId } from "../lib/ids.ts";
import { type Result, ok, appErr } from "../lib/result.ts";
import { emit } from "../realtime/events.ts";
import { audit } from "../db/repo/audit.ts";

type Session = { terminal: Bun.Terminal; proc: Bun.Subprocess; envId: string };
const sessions = new Map<string, Session>();

/** Minimal SDF workspace so suitecloud account:setup can run without a repo. */
export function ensureSdfWorkspace(envId: string): string {
  const dir = dataPath("sdf", envId);
  if (!existsSync(join(dir, "suitecloud.config.js"))) {
    mkdirSync(join(dir, "src", "FileCabinet", "SuiteScripts"), { recursive: true });
    mkdirSync(join(dir, "src", "Objects"), { recursive: true });
    Bun.write(join(dir, "suitecloud.config.js"), `module.exports = { defaultProjectFolder: "src", commands: {} };\n`);
    Bun.write(join(dir, "src", "manifest.xml"), `<manifest projecttype="ACCOUNTCUSTOMIZATION"><projectname>nsic-${envId.slice(0, 8)}</projectname><frameworkversion>1.0</frameworkversion></manifest>\n`);
    Bun.write(join(dir, "src", "deploy.xml"), `<deploy><files><path>~/FileCabinet/*</path></files><objects><path>~/Objects/*</path></objects></deploy>\n`);
  }
  return dir;
}

export function openSetupTerminal(envId: string, cwd?: string): Result<{ terminalId: string }> {
  const id = newId();
  const bin = config().suitecloudPath ?? Bun.which("suitecloud");
  if (!bin) return appErr("no_suitecloud", "SuiteCloud CLI not found on PATH. Install @oracle/suitecloud-cli or set SUITECLOUD_PATH.");
  const dec = new TextDecoder();
  const terminal = new Bun.Terminal({
    cols: 100,
    rows: 28,
    data: (_t, data) => emit({ type: "terminal.data", terminalId: id, data: dec.decode(data) }),
    exit: () => emit({ type: "terminal.data", terminalId: id, data: "\r\n[process exited]\r\n" }),
  });
  const proc = Bun.spawn([bin, "account:setup"], { cwd: cwd ?? ensureSdfWorkspace(envId), terminal, env: { ...process.env } });
  sessions.set(id, { terminal, proc, envId });
  void proc.exited.then(() => {
    setTimeout(() => {
      terminal.close();
      sessions.delete(id);
    }, 1000);
  });
  audit("user", "sdf.terminal.open", { environmentId: envId });
  return ok({ terminalId: id });
}

export function writeTerminal(id: string, data: string): boolean {
  const s = sessions.get(id);
  if (!s || s.terminal.closed) return false;
  s.terminal.write(data);
  return true;
}

export function closeTerminal(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  s.proc.kill();
  s.terminal.close();
  sessions.delete(id);
}
