-- Durable permission-request log, surfaced as synthetic chat-log entries.
--
-- Replaces the in-memory permission-audit map (7-day TTL, lost on
-- restart, rendered only as an inline pill). Every permission opencode
-- asks for - whether auto-approved by the worker, answered manually in
-- the UI, or rejected - lands here and is rendered chronologically in
-- the session chat log as an openportal-owned synthetic message
-- (source: vibekick / kind: permissions). The row is NEVER sent to
-- opencode; it is openportal's own durable record, so every client that
-- loads the session sees the same permission history with its answer.
--
-- Keyed by (session_id, request_id). session_id is opencode-global and
-- request_id is unique per permission, so that pair is the stable
-- identity of one permission - independent of which TCP port observed
-- it. This matters for the two-opencodes-sharing-port-4096 case AND for
-- the asked/resolved split: the auto-approve worker captures `asked`
-- with a concrete serverId, while the reply path only has `port`. If
-- server_id participated in uniqueness the two writes would not match
-- and we'd get duplicate rows. server_id is therefore an informational
-- column (which server's worker first saw the ask), NOT part of the key.
--
-- Lifecycle:
--   permission.asked SSE  -> INSERT row, status='pending', decided_at NULL
--   reply (auto/manual)   -> UPDATE same (server_id, session_id, request_id)
--                            row to status='resolved' + decision + auto
--                            + decided_at
--
-- The id column is an openportal-minted UUID for OUR row. It is NOT an
-- opencode-assigned id (request_id holds opencode's permission id),
-- so the "never pre-generate opencode ids" rule is not in play here.
--
-- message_id is opencode's owning assistant messageID (captured from the
-- pending permission's tool metadata) so the chat-log merge can splice
-- the synthetic entry into chronological position next to the tool call
-- that triggered it. asked_at is the chronological anchor.
-- patterns is a JSON-encoded string array.

CREATE TABLE IF NOT EXISTS permission_events (
  id              TEXT PRIMARY KEY,
  server_id       TEXT,
  session_id      TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  message_id      TEXT,
  call_id         TEXT,
  tool_name       TEXT,
  permission_type TEXT,
  patterns        TEXT NOT NULL DEFAULT '[]',
  title           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','resolved')),
  decision        TEXT CHECK (decision IN ('once','always','reject')),
  auto            INTEGER NOT NULL DEFAULT 0,
  asked_at        INTEGER NOT NULL,
  decided_at      INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_events_unique
  ON permission_events(server_id, session_id, request_id);

CREATE INDEX IF NOT EXISTS idx_permission_events_session_asked
  ON permission_events(session_id, asked_at);
