-- Pending-prompt lifecycle: openportal now owns delivery to opencode
-- and survives openportal restarts. Every /prompt POST writes a row
-- with status='pending' + the full opencode payload as JSON; a
-- background worker drains pending rows, calling opencode's
-- promptAsync; on success transitions to 'delivered', on repeated
-- failure to 'failed'. Existing rows backfill to 'sent' (= legacy
-- synchronous-delivery success).

ALTER TABLE prompts ADD COLUMN status TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE prompts ADD COLUMN port INTEGER;
ALTER TABLE prompts ADD COLUMN payload_json TEXT;
ALTER TABLE prompts ADD COLUMN delivered_at INTEGER;
ALTER TABLE prompts ADD COLUMN last_attempt_at INTEGER;
ALTER TABLE prompts ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE prompts ADD COLUMN last_error TEXT;

CREATE INDEX idx_prompts_pending ON prompts(status, ts_ms)
  WHERE status = 'pending';
