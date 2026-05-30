import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import init_0001 from "./migrations/0001_init.sql?raw";
import pending_0002 from "./migrations/0002_pending_prompts.sql?raw";
import opencode_msg_id_0003 from "./migrations/0003_opencode_message_id.sql?raw";
import cache_0004 from "./migrations/0004_message_session_cache.sql?raw";
import synthetic_0005 from "./migrations/0005_synthetic_messages.sql?raw";

interface Migration {
  version: number;
  sql: string;
}

// Append-only. To add migration N, append { version: N, sql: <import> }.
// Never edit a shipped migration in place.
const MIGRATIONS: Migration[] = [
  { version: 1, sql: init_0001 },
  { version: 2, sql: pending_0002 },
  { version: 3, sql: opencode_msg_id_0003 },
  { version: 4, sql: cache_0004 },
  { version: 5, sql: synthetic_0005 },
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
