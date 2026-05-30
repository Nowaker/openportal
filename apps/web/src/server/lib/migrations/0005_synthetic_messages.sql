-- Synthetic-only chat-log entries for the /btw side-question feature.
--
-- /btw is a Claude-Code-style "side question": ask a quick follow-up
-- about your work without polluting the parent session's conversation
-- history. Per AI_TODO #138, the redesign forks the parent at HEAD,
-- sends the question to the fork (background, hidden from sidebar),
-- gathers the assistant's response, archives the fork, and renders
-- BOTH the question and the answer in the PARENT chat log as
-- openportal-owned messages that never enter opencode's conversation
-- history of the parent.
--
-- Each row is one chat-log entry in the parent session:
--   - role 'user' = the /btw question (rendered like a prompt entry,
--     with /btw prefix label)
--   - role 'assistant' = the answer gathered from the fork
--
-- ordinal: monotonically increasing per parent_session_id; question
-- gets ordinal N, answer gets ordinal N+1. Tiebreaker for created_at.
-- btw_index: shared between the question + answer pair. Surfaces as
-- [btw#N] in both the answer header and the fork's title.
-- fork_session_id: ses_xxx of the background fork; populated on the
-- answer row only (question row precedes the fork's existence).

CREATE TABLE IF NOT EXISTS synthetic_messages (
  id                TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL,
  ordinal           INTEGER NOT NULL,
  btw_index         INTEGER NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text              TEXT NOT NULL,
  fork_session_id   TEXT,
  created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_synthetic_messages_parent_created
  ON synthetic_messages(parent_session_id, created_at);
