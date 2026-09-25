import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closePromptDbForTesting, getPromptDb } from "./prompt-db";

let root: string;
let path: string;
const migrations = ["0001_init", "0002_pending_prompts", "0003_opencode_message_id", "0004_message_session_cache", "0005_synthetic_messages", "0006_synthetic_messages_completed", "0007_permission_events"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "portal-db-upgrade-"));
  path = join(root, "portal.db");
  process.env.OPENPORTAL_DB_PATH = path;
  closePromptDbForTesting();
});
afterEach(() => {
  closePromptDbForTesting();
  delete process.env.OPENPORTAL_DB_PATH;
  rmSync(root, { recursive: true, force: true });
});

for (const baseline of [0, 7, 8, "draft8", "draft9"] as const) {
  test(`upgrades ${baseline} preserving data and supports repeat startup`, () => {
    const fixture = new Database(path);
    fixture.exec("PRAGMA synchronous=OFF");
    if (baseline !== 0) {
      for (const name of migrations) fixture.exec(readFileSync(join(import.meta.dir, "migrations", `${name}.sql`), "utf8"));
      fixture.exec("CREATE TABLE preserved_fixture (value TEXT); INSERT INTO preserved_fixture VALUES ('preserve me')");
      fixture.exec("INSERT INTO prompts (id, ts_ms, project_path, session_id, raw_text, raw_text_unfiltered, source) VALUES ('archived', 1, '/fixture', 'ses_fixture', 'preserved prompt', 'preserved prompt', 'prompt')");
    }
    if (baseline === 8) fixture.exec("CREATE TABLE managed_opencode_instances (id TEXT PRIMARY KEY, data TEXT); INSERT INTO managed_opencode_instances VALUES ('legacy', 'preserve managed state')");
    if (baseline === "draft8" || baseline === "draft9") {
      fixture.exec("CREATE TABLE prompt_dispatch (prompt_id TEXT PRIMARY KEY REFERENCES prompts(id) ON DELETE CASCADE, baseline_json TEXT NOT NULL, port INTEGER NOT NULL, directory TEXT, receipt_id TEXT)");
      if (baseline === "draft9") fixture.exec("ALTER TABLE prompt_dispatch ADD COLUMN receipt_text_sha256 TEXT");
      fixture.exec("INSERT INTO prompt_dispatch (prompt_id, baseline_json, port, receipt_id) VALUES ('archived', '[]', 6096, 'msg_preserved')");
    }
    fixture.exec(`PRAGMA user_version = ${baseline === "draft8" ? 8 : baseline === "draft9" ? 9 : baseline}`);
    fixture.close();

    const upgraded = getPromptDb();
    expect(upgraded.query("PRAGMA user_version").get()).toEqual({ user_version: 10 });
    expect(upgraded.query("SELECT name FROM pragma_table_info('prompt_dispatch') WHERE name='receipt_text_sha256'").get()).toEqual({ name: "receipt_text_sha256" });
    if (baseline !== 0) expect(upgraded.query("SELECT value FROM preserved_fixture").get()).toEqual({ value: "preserve me" });
    if (baseline !== 0) expect(upgraded.query("SELECT raw_text FROM prompts WHERE id='archived'").get()).toEqual({ raw_text: "preserved prompt" });
    if (typeof baseline === "string") expect(upgraded.query("SELECT receipt_id FROM prompt_dispatch WHERE prompt_id='archived'").get()).toEqual({ receipt_id: "msg_preserved" });
    if (baseline === 8) expect(upgraded.query("SELECT * FROM managed_opencode_instances").get()).toEqual({ id: "legacy", data: "preserve managed state" });
    closePromptDbForTesting();
    expect(getPromptDb().query("PRAGMA user_version").get()).toEqual({ user_version: 10 });
  }, 30_000);
}
