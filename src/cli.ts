// Small CLI: bun run nsic <command>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { generateMasterKeyB64 } from "./lib/crypto.ts";

const [cmd, ...args] = process.argv.slice(2);
const envPath = join(config().rootDir, ".env");

switch (cmd) {
  case "init": {
    if (!existsSync(envPath)) writeFileSync(envPath, readFileSync(join(config().rootDir, ".env.example"), "utf8"));
    let env = readFileSync(envPath, "utf8");
    if (/^NSIC_MASTER_KEY=\s*$/m.test(env)) {
      env = env.replace(/^NSIC_MASTER_KEY=\s*$/m, `NSIC_MASTER_KEY=${generateMasterKeyB64()}`);
      writeFileSync(envPath, env);
      console.log("NSIC_MASTER_KEY created in .env. Back up this key separately from the data/ folder.");
    } else console.log(".env already has NSIC_MASTER_KEY.");
    const { db } = await import("./db/db.ts");
    db();
    console.log("Database ready. Run bun run dev, then choose Claude API, Claude Code, or Codex in Settings.");
    break;
  }
  case "system-check": {
    const { llmStatus } = await import("./llm/anthropic.ts");
    const { $ } = await import("bun");
    const { chromePath } = await import("./browser/driver.ts");
    const { ffmpegPath } = await import("./browser/recorder.ts");
    const rows: [string, boolean, string][] = [
      ["Bun", true, Bun.version],
      ["git", (await $`git --version`.nothrow().quiet()).exitCode === 0, "repo pairing"],
      ["Chrome", !!chromePath(config().chromePath), chromePath(config().chromePath) ?? "set CHROME_PATH"],
      ["ffmpeg", !!ffmpegPath(), ffmpegPath() ?? "brew install ffmpeg"],
      ["SuiteCloud CLI", !!(config().suitecloudPath ?? Bun.which("suitecloud")), "npm i -g @oracle/suitecloud-cli"],
      ["LLM engine", llmStatus().ok, llmStatus().detail],
      ["NSIC_MASTER_KEY", !!config().masterKeyB64, "bun run nsic init"],
    ];
    for (const [n, ok, d] of rows) console.log(`${ok ? "ok     " : "missing"} ${n.padEnd(18)} ${d}`);
    break;
  }
  case "rotate-key": {
    const { rotateAll } = await import("./netsuite/credentials.ts");
    const old = config().masterKeyB64;
    if (!old) throw new Error("NSIC_MASTER_KEY is not set");
    const next = generateMasterKeyB64();
    const version = Number(args[0] ?? 2);
    const r = await rotateAll(old, next, version);
    if (!r.ok) throw new Error(r.error.message);
    writeFileSync(envPath, readFileSync(envPath, "utf8").replace(/^NSIC_MASTER_KEY=.*$/m, `NSIC_MASTER_KEY=${next}`));
    console.log(`${r.value} credentials re-encrypted (key_version ${version}). .env updated.`);
    break;
  }
  case "backup": {
    const { backupDb } = await import("./jobs/cron.ts");
    console.log(backupDb());
    break;
  }
  default:
    console.log("Commands: init | system-check | rotate-key [version] | backup");
}
