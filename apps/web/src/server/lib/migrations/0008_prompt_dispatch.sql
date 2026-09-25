-- Persist the pre-dispatch fence before sending. An interrupted or ambiguous
-- request is reconciled read-only instead of being submitted a second time.
CREATE TABLE prompt_dispatch (
  prompt_id TEXT PRIMARY KEY REFERENCES prompts(id) ON DELETE CASCADE,
  baseline_json TEXT NOT NULL,
  port INTEGER NOT NULL,
  directory TEXT,
  receipt_id TEXT
);
