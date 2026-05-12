import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import init_0001 from "./migrations/0001_init.sql?raw";

interface Migration {
  version: number;
  sql: string;
}

// Append-only. To add migration N, append { version: N, sql: <import> }.
// Never edit a shipped migration in place.
const MIGRATIONS: Migration[] = [
  { version: 1, sql: init_0001 },
];

const TARGET_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

let db: Database | null = null;

function defaultDbPath(): string {
  const explicit = process.env.OPENPORTAL_DB_PATH;
  if (explicit && explicit.length > 0) return explicit;
  return join(homedir(), ".local", "share", "openportal", "openportal.db");
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function runMigrations(handle: Database): void {
  const current = (handle.query("PRAGMA user_version").get() as
    | { user_version: number }
    | null)?.user_version ?? 0;
  if (current >= TARGET_VERSION) return;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    handle.transaction(() => {
      handle.exec(m.sql);
      handle.exec(`PRAGMA user_version = ${m.version}`);
    })();
  }
}

export function getPromptDb(): Database {
  if (db) return db;
  const path = defaultDbPath();
  ensureDir(path);
  const handle = new Database(path, { create: true });
  handle.exec("PRAGMA journal_mode = WAL");
  handle.exec("PRAGMA synchronous = NORMAL");
  handle.exec("PRAGMA foreign_keys = ON");
  runMigrations(handle);
  db = handle;
  return db;
}

export function closePromptDbForTesting(): void {
  db?.close();
  db = null;
}
