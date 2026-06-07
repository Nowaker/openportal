#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SESSION_ID = "ses_openportal_render_check";
const SERVER_PORT = Number(process.env.OPENPORTAL_RENDER_CHECK_PORT ?? "4096");
const TEST_PROJECT_DIR = process.env.OPENPORTAL_RENDER_CHECK_PROJECT ?? join(homedir(), "projekty", "nowaker", "vibekick-test");
const DB_PATH = process.env.OPENPORTAL_DB_PATH ?? join(homedir(), ".local", "share", "openportal", "openportal.db");
const now = Date.now();
const base = now - 120_000;

mkdirSync(dirname(DB_PATH), { recursive: true });
mkdirSync(TEST_PROJECT_DIR, { recursive: true });
writeFileSync(join(TEST_PROJECT_DIR, ".gitkeep"), "render-check fixture project\n", "utf8");
spawnSync("git", ["init"], { cwd: TEST_PROJECT_DIR, stdio: "ignore" });

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec(`CREATE TABLE IF NOT EXISTS messages_cache (
  session_id    TEXT PRIMARY KEY,
  fetched_at    INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  messages_json TEXT NOT NULL
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_cache_fetched
  ON messages_cache(fetched_at)`);
db.exec(`CREATE TABLE IF NOT EXISTS sessions_cache (
  port          INTEGER PRIMARY KEY,
  fetched_at    INTEGER NOT NULL,
  session_count INTEGER NOT NULL,
  sessions_json TEXT NOT NULL
)`);

function textPart(id, messageId, text, at) {
  return {
    id,
    sessionID: SESSION_ID,
    messageID: messageId,
    type: "text",
    text,
    synthetic: null,
    ignored: null,
    time: { start: at, end: at + 10 },
    metadata: null,
  };
}

function stepStart(id, messageId) {
  return { id, sessionID: SESSION_ID, messageID: messageId, type: "step-start" };
}

function stepFinish(id, messageId, reason = "stop") {
  return {
    id,
    sessionID: SESSION_ID,
    messageID: messageId,
    type: "step-finish",
    reason,
    cost: 0,
    tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

function toolPart(id, messageId, tool, status, input, output, at, extra = {}) {
  return {
    id,
    sessionID: SESSION_ID,
    messageID: messageId,
    type: "tool",
    callID: `call_${id}`,
    tool,
    state: {
      status,
      input,
      output,
      metadata: { output: typeof output === "string" ? output : JSON.stringify(output), exit: status === "error" ? 1 : 0, truncated: false },
      time: { start: at, end: at + 100 },
    },
    time: { start: at, end: at + 100 },
    metadata: { openportalRenderCheck: true, ...extra },
  };
}

function filePart(id, messageId, mime, filename, url) {
  return { id, sessionID: SESSION_ID, messageID: messageId, type: "file", mime, filename, url };
}

function message(id, role, created, parts, extra = {}) {
  return {
    info: {
      id,
      sessionID: SESSION_ID,
      role,
      time: { created, completed: role === "assistant" ? created + 1000 : undefined },
      error: null,
      parentID: null,
      modelID: extra.modelID ?? (role === "assistant" ? "gpt-5.5" : undefined),
      providerID: extra.providerID ?? (role === "assistant" ? "openai" : undefined),
      mode: extra.mode ?? (role === "assistant" ? "OpenPortal render fixture" : undefined),
      agent: extra.agent ?? (role === "assistant" ? "OpenPortal render fixture" : undefined),
      path: { cwd: TEST_PROJECT_DIR, root: TEST_PROJECT_DIR },
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      variant: extra.variant ?? "medium",
      finish: extra.finish ?? (role === "assistant" ? "stop" : undefined),
      ...extra.info,
    },
    parts,
    isQueued: extra.isQueued,
  };
}

const messages = [
  message("msg_render_001_user", "user", base, [
    textPart("prt_render_001_text", "msg_render_001_user", "Please exercise OpenPortal render surfaces.\n\n<system-reminder>OMO wrapper fixture</system-reminder>\n\n/template Render Check Template\n\nAttached files should render below.", base),
    filePart("prt_render_001_file_text", "msg_render_001_user", "text/plain", "notes.txt", "data:text/plain;base64,UmVuZGVyIGNoZWNrIHRleHQgYXR0YWNobWVudAo="),
    filePart("prt_render_001_file_image", "msg_render_001_user", "image/png", "pixel.png", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lqVYLwAAAABJRU5ErkJggg=="),
  ]),
  message("msg_render_002_assistant", "assistant", base + 10_000, [
    stepStart("prt_render_002_step", "msg_render_002_assistant"),
    textPart("prt_render_002_text", "msg_render_002_assistant", "First assistant response. This row verifies markdown, metadata, copy/revert/fork controls, and session id linkification: ses_openportal_render_check.", base + 10_000),
    toolPart("prt_render_002_bash", "msg_render_002_assistant", "bash", "completed", { command: "printf render-check", description: "Render-check successful shell command" }, "render-check", base + 11_000),
    toolPart("prt_render_002_failed", "msg_render_002_assistant", "bash", "error", { command: "false", description: "Expected failing command" }, "exit status 1", base + 12_000),
    stepFinish("prt_render_002_finish", "msg_render_002_assistant", "tool-calls"),
  ], { finish: "tool-calls" }),
  message("msg_render_003_user", "user", base + 20_000, [
    textPart("prt_render_003_text", "msg_render_003_user", "/btw Does the synthetic side-question surface render?\n\nContinue with tool and question fixtures.", base + 20_000),
  ]),
  message("msg_render_004_assistant", "assistant", base + 30_000, [
    stepStart("prt_render_004_step", "msg_render_004_assistant"),
    textPart("prt_render_004_text", "msg_render_004_assistant", "Question fixture below should render with radio and checkbox controls.", base + 30_000),
    toolPart("prt_render_004_question", "msg_render_004_assistant", "question", "running", {
      questions: [
        { header: "Radio", question: "Pick one render path", multiple: false, options: [{ label: "Happy", description: "Happy path" }, { label: "Error", description: "Error path" }] },
        { header: "Checkboxes", question: "Pick all visible widgets", multiple: true, options: [{ label: "Tool calls", description: "Tool rows" }, { label: "Attachments", description: "File chips" }] },
      ],
    }, null, base + 31_000),
  ], { finish: "tool-calls", info: { time: { created: base + 30_000 } } }),
  message("msg_render_005_assistant", "assistant", base + 40_000, [
    stepStart("prt_render_005_step", "msg_render_005_assistant"),
    toolPart("prt_render_005_task_bg", "msg_render_005_assistant", "task", "completed", { description: "background render subtask", run_in_background: true }, "session_id: ses_render_child_bg", base + 40_000),
    toolPart("prt_render_005_task_fg", "msg_render_005_assistant", "task", "completed", { description: "foreground render subtask", run_in_background: false }, "session_id: ses_render_child_fg", base + 41_000),
    { id: "prt_render_005_compaction", sessionID: SESSION_ID, messageID: "msg_render_005_assistant", type: "compaction", auto: true, overflow: false, tail_start_id: "msg_render_003_user" },
    stepFinish("prt_render_005_finish", "msg_render_005_assistant"),
  ]),
  message("msg_render_006_assistant_error", "assistant", base + 50_000, [
    stepStart("prt_render_006_step", "msg_render_006_assistant_error"),
    stepFinish("prt_render_006_finish", "msg_render_006_assistant_error", "error"),
  ], { info: { error: { name: "RenderCheckError", message: "Intentional fixture assistant error", stack: "RenderCheckError: intentional fixture" }, finish: "error" } }),
  message("msg_render_007_queued", "user", base + 60_000, [
    textPart("prt_render_007_text", "msg_render_007_queued", "Queued fixture user message with no following assistant response.", base + 60_000),
  ], { isQueued: true }),
];

const session = {
  id: SESSION_ID,
  title: "OpenPortal render check fixture",
  directory: TEST_PROJECT_DIR,
  parentID: null,
  version: "render-check",
  share: null,
  time: { created: base, updated: base + 60_000 },
  summary: { additions: 1, deletions: 0, files: 2 },
  model: { id: "gpt-5.5", providerID: "openai", variant: "medium" },
  agent: "OpenPortal render fixture",
};

function mergeSessions(existing, fixture) {
  const rows = Array.isArray(existing) ? existing.filter((s) => s?.id !== fixture.id) : [];
  rows.unshift(fixture);
  return rows;
}

const existingSessionsRow = db.query("SELECT sessions_json FROM sessions_cache WHERE port = ?").get(SERVER_PORT);
let existingSessions = [];
if (existingSessionsRow?.sessions_json) {
  try {
    const parsed = JSON.parse(existingSessionsRow.sessions_json);
    if (Array.isArray(parsed)) existingSessions = parsed;
  } catch {}
}
const sessions = mergeSessions(existingSessions, session);

db.run(
  `INSERT INTO sessions_cache (port, fetched_at, session_count, sessions_json)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(port) DO UPDATE SET fetched_at = excluded.fetched_at,
     session_count = excluded.session_count,
     sessions_json = excluded.sessions_json`,
  [SERVER_PORT, now, sessions.length, JSON.stringify(sessions)],
);
db.run(
  `INSERT INTO messages_cache (session_id, fetched_at, message_count, messages_json)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(session_id) DO UPDATE SET fetched_at = excluded.fetched_at,
     message_count = excluded.message_count,
     messages_json = excluded.messages_json`,
  [SESSION_ID, now, messages.length, JSON.stringify(messages)],
);
db.close();

console.log(`seeded ${SESSION_ID}`);
console.log(`db=${DB_PATH}`);
console.log(`port=${SERVER_PORT}`);
console.log(`project=${TEST_PROJECT_DIR}`);
