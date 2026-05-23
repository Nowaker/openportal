-- Smart-dedup via opencode message ID. Per the opencode SDK contract,
-- both /session/{id}/prompt_async and /session/{id}/command accept an
-- optional `messageID` field on the request body. When portal supplies
-- it, opencode persists the user message with that exact ID. Storing
-- the same ID on the archive row lets messages.ts dedup match by ID
-- instead of guessing via raw_text - which fails for slash commands
-- (opencode expands the template, the emitted user message text bears
-- no resemblance to the archived '/foo bar' string).
--
-- Nullable because:
--   1. Legacy rows (pre-this-migration) don't have it.
--   2. The synchronous /command path used to NOT generate one; backfill
--      logic handles those by leaving the column NULL and falling
--      through to text-based dedup as today.

ALTER TABLE prompts ADD COLUMN opencode_message_id TEXT;
