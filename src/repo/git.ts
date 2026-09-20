// git wrapper via Bun.$ (no shell injection: Bun.$ escapes arguments).
import { $ } from "bun";
import { type Result, ok, appErr } from "../lib/result.ts";

async function run(cwd: string, args: string[]): Promise<Result<string>> {
  const r = await $`git ${args}`.cwd(cwd).nothrow().quiet();
  if (r.exitCode !== 0) return appErr("git_failed", `git ${args[0]} failed: ${r.stderr.toString().trim().slice(0, 400)}`);
  return ok(r.stdout.toString().trim());
}

export const isGitRepo = async (dir: string) => (await run(dir, ["rev-parse", "--is-inside-work-tree"])).ok;
export const headCommit = async (dir: string) => run(dir, ["rev-parse", "HEAD"]);
export const currentBranch = async (dir: string) => run(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
export const changedFiles = async (dir: string, from: string) => {
  const r = await run(dir, ["diff", "--name-only", `${from}..HEAD`]);
  return r.ok ? ok(r.value.split("\n").filter(Boolean)) : r;
};
export const clone = async (url: string, dest: string) => {
  if (!/^(https:\/\/|git@|ssh:\/\/)/.test(url)) return appErr("git_url", "The git URL must start with https://, ssh://, or git@");
  const r = await $`git clone --depth 50 ${url} ${dest}`.nothrow().quiet();
  return r.exitCode === 0 ? ok(dest) : appErr("git_clone", r.stderr.toString().slice(0, 400));
};
export const pull = async (dir: string) => run(dir, ["pull", "--ff-only"]);
export const statusPorcelain = async (dir: string) => run(dir, ["status", "--porcelain"]);

/** Create/checkout branch nsic/{issueKey} and apply a unified diff (05 §4 git_branch_and_patch). */
export async function branchAndPatch(dir: string, branch: string, patch: string): Promise<Result<{ branch: string; files: string[] }>> {
  if (!/^nsic\/[A-Za-z0-9._-]+$/.test(branch)) return appErr("git_branch", "the branch name must be nsic/<issueKey>");
  const exists = await run(dir, ["rev-parse", "--verify", branch]);
  const co = exists.ok ? await run(dir, ["checkout", branch]) : await run(dir, ["checkout", "-b", branch]);
  if (!co.ok) return co;
  const p = await $`git apply --whitespace=nowarn --index - < ${new Response(patch)}`.cwd(dir).nothrow().quiet();
  if (p.exitCode !== 0) return appErr("git_apply", `patch failed to apply: ${p.stderr.toString().slice(0, 400)}`);
  const files = await run(dir, ["diff", "--cached", "--name-only"]);
  const commit = await run(dir, ["commit", "-m", `nsic: fix ${branch.slice(5)}`, "--no-verify"]);
  if (!commit.ok) return commit;
  return ok({ branch, files: files.ok ? files.value.split("\n").filter(Boolean) : [] });
}

export const diffAgainst = async (dir: string, base: string) => run(dir, ["diff", `${base}...HEAD`]);
