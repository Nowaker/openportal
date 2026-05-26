-- Caching proxy: SQLite-backed message + session list caches that
-- survive openportal restart.
--
-- User's caching-proxy directive (verbatim):
--
--   'openportal must be a caching proxy for opencode. If you see
--   msgid 1 in sesid 1, you cache it! You know it's there. Only
--   when you hear from opencode AUTHORITATIVELY (not a fucking
--   timeout or empty array due to a bug or something) that it's
--   not there, should you update your cache and no longer display.'
--
-- The 5 prior caching-proxy commits (6679f61, faf3d24, 495e6a7,
-- ef5fe93, a6cdbcf) added stale-while-revalidate + single-flight +
-- probe caching, but left the cache memory-only. Restart wiped
-- everything; a cold reload while opencode is slow/down triggers
-- the 'OpenCode is unreachable' panel even though we have a
-- perfectly good last-known-good list on disk.
--
-- These tables persist the last authoritative opencode response.
-- On startup the in-memory LRU stays empty; first request per
-- session/port hydrates from SQLite into memory, subsequent reads
-- hit memory. Writes go memory + SQLite in the same call.

CREATE TABLE IF NOT EXISTS messages_cache (
  session_id    TEXT PRIMARY KEY,
  fetched_at    INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  messages_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_cache_fetched
  ON messages_cache(fetched_at);

CREATE TABLE IF NOT EXISTS sessions_cache (
  port          INTEGER PRIMARY KEY,
  fetched_at    INTEGER NOT NULL,
  session_count INTEGER NOT NULL,
  sessions_json TEXT NOT NULL
);
