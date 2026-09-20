import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../config.ts";
import { migrate } from "./migrate.ts";

let current: Database | undefined;

export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA synchronous = NORMAL");
  migrate(db);
  return db;
}

export function db(): Database {
  return (current ??= openDb(join(config().dataDir, "nsic.db")));
}

export function setDbForTest(d: Database) {
  current = d;
}

export type Row = Record<string, unknown>;

export function tx<T>(fn: () => T): T {
  return db().transaction(fn)();
}
