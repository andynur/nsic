// PRAGMA user_version-based migrations (04 §2). Idempotent: only files numbered > user_version are run.
import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "migrations");

export function listMigrations(): { version: number; name: string; sql: string }[] {
  return readdirSync(DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: Number(f.slice(0, 3)), name: f, sql: readFileSync(join(DIR, f), "utf8") }));
}

export function migrate(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as { user_version: number };
  let v = row.user_version;
  for (const m of listMigrations()) {
    if (m.version <= v) continue;
    db.transaction(() => {
      db.run(m.sql);
      db.run(`PRAGMA user_version = ${m.version}`);
    })();
    v = m.version;
  }
  return v;
}

if (import.meta.main) {
  const { db } = await import("./db.ts");
  const d = db();
  const v = (d.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  console.log(`db migrated to version ${v}`);
}
