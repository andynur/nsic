// SuiteCloud CLI wrapper (07 §5). Deploy only to sandbox (also checked in the tool registry: two places).
import { $ } from "bun";
import { type Result, ok, appErr } from "../lib/result.ts";
import { getEnvironment } from "../db/repo/environments.ts";
import { audit } from "../db/repo/audit.ts";
import { config } from "../config.ts";

const bin = () => config().suitecloudPath ?? "suitecloud";

export async function suitecloudAvailable(): Promise<boolean> {
  const r = await $`${bin()} --version`.nothrow().quiet();
  return r.exitCode === 0;
}

async function run(cwd: string, args: string[], timeoutMs = 10 * 60_000): Promise<Result<{ stdout: string; stderr: string; exitCode: number }>> {
  const p = Bun.spawn([bin(), ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, SUITECLOUD_CI: "1" } });
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const exitCode = await p.exited;
  clearTimeout(timer);
  return ok({ stdout, stderr, exitCode });
}

export async function listAuthIds(cwd: string): Promise<Result<string[]>> {
  const r = await run(cwd, ["account:manageauth", "--list"], 60_000);
  if (!r.ok) return r;
  if (r.value.exitCode !== 0) return appErr("sdf_auth", r.value.stderr || r.value.stdout);
  return ok(r.value.stdout.split("\n").map((l) => /^\s*(\S+)\s*\|/.exec(l)?.[1]).filter((x): x is string => !!x));
}

export type ValidateResult = { ok: boolean; errors: string[]; warnings: string[]; output: string };

export function parseValidateOutput(out: string, exitCode: number): ValidateResult {
  const lines = out.split(/\r?\n/);
  const errors = lines.filter((l) => /\berror\b/i.test(l) && !/0 error/i.test(l)).map((l) => l.trim());
  const warnings = lines.filter((l) => /\bwarning\b/i.test(l)).map((l) => l.trim());
  return { ok: exitCode === 0 && errors.length === 0, errors, warnings, output: out.slice(-8000) };
}

export async function validateProject(sdfDir: string, server = true): Promise<Result<ValidateResult>> {
  const r = await run(sdfDir, ["project:validate", ...(server ? ["--server"] : [])]);
  if (!r.ok) return r;
  return ok(parseValidateOutput(r.value.stdout + "\n" + r.value.stderr, r.value.exitCode));
}

/** An explicit deploy.xml containing only the affected files/objects (07 §5 safeguard 2). */
export function buildDeployXml(paths: string[]): string {
  const files = paths.filter((p) => p.includes("FileCabinet/")).map((p) => `~/FileCabinet/${p.split("FileCabinet/")[1]}`);
  const objs = paths.filter((p) => p.includes("Objects/")).map((p) => `~/Objects/${p.split("Objects/")[1]}`);
  const x = (tag: string, list: string[]) => (list.length ? `  <${tag}>\n${list.map((p) => `    <path>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</path>`).join("\n")}\n  </${tag}>\n` : "");
  return `<deploy>\n${x("files", files)}${x("objects", objs)}</deploy>\n`;
}

export async function deploySandbox(envId: string, sdfDir: string, changedPaths: string[], authId: string): Promise<Result<{ output: string }>> {
  const env = getEnvironment(envId);
  // Second check (the first is in the tool registry): sandbox only.
  if (!env || env.kind !== "sandbox") {
    audit("agent", "sdf.deploy.blocked", { environmentId: envId, detail: { reason: "not a sandbox", kind: env?.kind } });
    return appErr("deploy_blocked", "Deploy is only allowed to a sandbox environment");
  }
  if (!changedPaths.length) return appErr("deploy_empty", "No files/objects to deploy");
  await Bun.write(`${sdfDir}/deploy.xml`, buildDeployXml(changedPaths));
  const v = await validateProject(sdfDir, true);
  if (!v.ok) return v;
  if (!v.value.ok) return appErr("validate_failed", `project:validate failed: ${v.value.errors.slice(0, 5).join("; ")}`);
  audit("user", "sdf.deploy", { environmentId: envId, detail: { paths: changedPaths, authId } });
  const r = await run(sdfDir, ["project:deploy", "--authid", authId]);
  if (!r.ok) return r;
  if (r.value.exitCode !== 0) return appErr("deploy_failed", (r.value.stderr || r.value.stdout).slice(-2000));
  return ok({ output: r.value.stdout.slice(-4000) });
}
