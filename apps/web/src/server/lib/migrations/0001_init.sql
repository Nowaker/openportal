-- Initial schema for openportal-native prompt archive.
--
-- 'prompts' is the canonical user-input log: every submission to
-- /api/opencode/:port/session/:id/prompt or /api/opencode/:port/session/:id/command
-- inserts one row. Idempotency comes from a uuid primary key generated client-side
-- (the capture path generates the id, so this table never sees an upsert).
--
-- 'prompts_fts' is an external-content FTS5 index over raw_text only (the filtered
-- form, since that's what humans search). raw_text_unfiltered is intentionally
-- excluded from the index so accidental matches in stripped ralph/ultrawork noise
-- don't pollute search results. The classic SQLite FTS5 contentless-pattern with
-- AFTER INSERT / BEFORE DELETE / AFTER UPDATE triggers keeps the index in sync
-- without manual rebuilds. Reference: https://www.sqlite.org/fts5.html#external_content_tables

CREATE TABLE prompts (
  id                   TEXT PRIMARY KEY,        -- uuid v4, generated at capture time
  ts_ms                INTEGER NOT NULL,        -- epoch ms of capture
  project_path         TEXT NOT NULL,           -- opencode session.directory (cwd / project root)
  session_id           TEXT NOT NULL,
  parent_session_id    TEXT,                    -- session.parentID from opencode, NULL for top-level
  raw_text             TEXT NOT NULL,           -- filtered prose, the canonical display form
  raw_text_unfiltered  TEXT NOT NULL,           -- everything sent, retained for forensics
  model_provider       TEXT,                    -- e.g. 'anthropic', 'openai'
  model_id             TEXT,                    -- e.g. 'claude-opus-4-7'
  agent                TEXT,                    -- agent override if any
  variant              TEXT,                    -- variant override if any
  source               TEXT NOT NULL,           -- 'prompt' or 'command'
  attachments_count    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_prompts_project_session_ts ON prompts(project_path, session_id, ts_ms);
CREATE INDEX idx_prompts_ts ON prompts(ts_ms);
CREATE INDEX idx_prompts_session ON prompts(session_id);

-- FTS5 over raw_text only. content='prompts' means the index does NOT store
-- its own copy of the text - it points back at rowid in 'prompts'. That keeps
-- the on-disk footprint minimal for our growth profile (years of prompts).
CREATE VIRTUAL TABLE prompts_fts USING fts5(
  raw_text,
  content='prompts',
  content_rowid='rowid'
);

-- BEFORE DELETE fires the 'delete' command on the FTS table so old tokens
-- are removed before the row vanishes (canonical FTS5 external-content
-- pattern, https://www.sqlite.org/fts5.html#external_content_tables).
CREATE TRIGGER prompts_ai AFTER INSERT ON prompts BEGIN
  INSERT INTO prompts_fts(rowid, raw_text) VALUES (new.rowid, new.raw_text);
END;

CREATE TRIGGER prompts_ad BEFORE DELETE ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, raw_text) VALUES('delete', old.rowid, old.raw_text);
END;

CREATE TRIGGER prompts_au BEFORE UPDATE OF raw_text ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, raw_text) VALUES('delete', old.rowid, old.raw_text);
END;

CREATE TRIGGER prompts_au_after AFTER UPDATE OF raw_text ON prompts BEGIN
  INSERT INTO prompts_fts(rowid, raw_text) VALUES (new.rowid, new.raw_text);
END;
