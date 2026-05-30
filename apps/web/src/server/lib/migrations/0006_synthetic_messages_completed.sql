-- Add completed_at to synthetic_messages so the /btw assistant row
-- can be inserted as PENDING (completed_at IS NULL) immediately when
-- /btw is dispatched, then UPDATED with the real text + completion
-- timestamp when the background fork finishes.
--
-- messages.ts wrapper now maps completed_at -> info.time.completed
-- so the chat-log renders the in-flight assistant via the existing
-- "Thinking..." indicator pattern; no new frontend code needed for
-- the loading affordance.
--
-- v1 rows were inserted as already-completed (text was final at
-- insert). Backfill them with completed_at=created_at so the
-- wrapper renders them as completed and we don't show a "Thinking"
-- placeholder for historical entries.

ALTER TABLE synthetic_messages ADD COLUMN completed_at INTEGER;
UPDATE synthetic_messages SET completed_at = created_at WHERE completed_at IS NULL;
