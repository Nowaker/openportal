---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T18:06:54-05:00
legacy_number: 63
commits:
  attributed:
    - 357c8e4e29e8
  on_main:
    - 357c8e4e29e8
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# SQLite-persisted caching proxy + ERR_INSUFFICIENT_RESOURCES spam fix

User prompts (chained, all about the same caching-proxy directive plus its follow-up regression):

> Shit is totally destroyed when opencode has high latency 502 bad gateway all the fucking time. ... openportal must be a caching proxy for opencode. If you see msgid 1 in sesid 1, you cache it! ... Only when you hear from opencode AUTHORITATIVELY (not a fucking timeout or empty array due to a bug or something) that it's not there, should you update your cache. ... THIS APPLIES TO EVERYTHING. Projects list in sidebar. ... All shit must go through openportal and be cached for high latency situations.

> index-DMCrwyIF.js:58 GET /api/opencode/4096/session/.../messages net::ERR_INSUFFICIENT_RESOURCES ... a spam of messages, in tens per second. /api/state/last-viewed in 20-40 per second. fix asap.

Design notes:

- 357c8e4 (SQLite persistence): Migration 0004 adds two tables: `messages_cache(session_id, fetched_at, message_count, messages_json)` keyed per-session, and `sessions_cache(port, fetched_at, session_count, sessions_json)` keyed per-port. messages-cache.ts + sessions-cache.ts now write memory + SQLite inline on every `setCachedMessages` / `setCachedSessions`; `getStaleMessages` / `getStaleSessions` hydrate from SQLite on memory miss and populate the in-memory LRU so subsequent reads stay fast. MAX_PERSISTED_SESSIONS=1000 LRU on disk (oldest fetched_at evicted). Shrink guard: setCachedMessages/setCachedSessions refuse to overwrite a cached list with a SHORTER one (suspicious partial response per the authoritative-only invariant). Legitimate trims (revert, delete, session.deleted SSE event) flow through invalidateMessagesCache/invalidateSessionsCache which drop the SQLite row + clear the throttle map so the next set writes fresh. Frontend fix in `routes/_app/session/$id.tsx`: "OpenCode is unreachable" panel only renders when `messages.length === 0` in addition to `opencodeUnreachable`, so a loaded chat log (memory or SQLite-hydrated) is never obscured.

- cf8e96e (spam regression hotfix): Two independent failure modes ganged up post-357c8e4. (a) The 12,802-message session's messages_json blob is ~35 MB; without throttling, SWR poll + SSE-driven fetchAndCache stacked tens of MB of SQLite writes per second, blocking the Bun event loop and exhausting the browser's per-host pool. Fixed with `PERSIST_THROTTLE_MS = 30_000` per cache key (in-memory LRU still updates on every set; SQLite write fires at most once per 30s per session/port). (b) `useMarkViewed` returned a fresh closure on every render so the useEffect at `$id.tsx:3508` (deps include the function ref) re-fired every render — 20-40 POSTs/sec to `/api/state/last-viewed` on busy sessions. Fixed by wrapping `useMarkViewed` + `useMarkManyViewed` in `useCallback` (stable ref across renders) AND adding `MARK_VIEWED_THROTTLE_MS = 5_000` per sessionId so even effect re-fires hit a cheap Map-lookup early-return.

Remaining deferred (would ship if needed): append-only per-message merge on shrink-passing writes (opencode never trims from the middle in practice; explicit invalidate covers revert/delete); bootstrap-cache.ts (agents/config/providers) SQLite persistence (memory-only today, much smaller cold-load impact than messages/sessions).
