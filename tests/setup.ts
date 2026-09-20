// Preload test: in-memory DB + temporary config data dir. The LLM is never called for real.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, setConfigForTest } from "../src/config.ts";
import { openDb, setDbForTest } from "../src/db/db.ts";

process.env.NODE_ENV = "test";
const dir = mkdtempSync(join(tmpdir(), "nsic-test-"));
setConfigForTest({ ...loadConfig({ ...process.env, DATA_DIR: dir, ANTHROPIC_API_KEY: "", NSIC_MASTER_KEY: Buffer.alloc(32, 7).toString("base64") }) });
setDbForTest(openDb(":memory:"));
