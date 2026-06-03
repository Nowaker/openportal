---
status: DONE
commit: 6679f61
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T18:06:54-05:00
legacy_number: 54
---

# Caching-proxy major refactor: stale-while-revalidate everywhere + STUCK badge clickable + sound dropdown width capped + SQLite persistence across restarts

User prompt (full directive):

> Shit is totally destroyed when opencode has high latency 502 bad gateway all the fucking time. If it takes forever for something to load, so be it, it's okay. Don't just timeout and say "no messages" and "Live session messages can't load until OpenCode is back. The connection monitor is retrying every 10 seconds. Prompts archive, settings, and the server list still work in the meantime." and failed to fetch, all in one session over 3 minutes time. This is pure fucking nonsense. It wasn't like that before. Inspect git history and your memories to figure out what changes were done, and reason about it. THIS MUST BE FIXED. openportal must be a caching proxy for opencode. If you see msgid 1 in sesid 1, you cache it! You know it's there. Only when you hear from opencode AUTHORITATIVELY (not a fucking timeout or empty array due to a bug or something) that it's not there, should you update your cache and no longer display. Openportal MUST NOT be a dumb proxy where all shit gets forwarded to opencode, and if it's down or slow, openportal is slow. No. Maintain your own view of the world, and update it as opencode is giving you modifications. THIS APPLIES TO EVERYTHING. Projects list in sidebar. In progress status of session (derived from stuck detector, the most accurate source of status). Session title. Tool calls, Ai responses, user prompts. ALL THE SHIT MUST GO THROUGH OPENPORTAL AND BE CACHED FOR HIGH LATENCY SITUATIONS. Wherever user can submit things, it also goes to cache and stays there until reconciled with opencode, eg the user submitted message came back with message id = good.

Plus inline UI items:
> 1. Notification sounds dropdown for filename is enormous. it causes the text in first column to be multiline (7 lines wtf)
> 2. STUCK badge present but nothing actionable about it. stuck badge should be clickable, and offer action to unstuck it.

Design notes (architecture, multi-commit):
- 6679f61: caching proxy messages + opencode probe — removed the 3s Promise.race timeout in fetchAndCache, added stale-while-revalidate to loadFullMessages, single-flight INFLIGHT map, probe-cache.ts with UP=60s/DOWN=5s. /api/instance/self stops flapping to opencode-down on slow probes.
- faf3d24: caching proxy sessions list (sidebar) — new sessions-cache.ts module, mirrored pattern. Invalidates on SSE session.* events + /prompt + /command.
- 495e6a7: bootstrap (agents/config/providers) past-STALE_MS returns cached + background refresh instead of blocking + throwing. Never 502s a cached endpoint.
- ef5fe93: single-session GET reads from sessions-cache fast path. Modal opens instantly from cache, no opencode round-trip.
- a6cdbcf: STUCK badge clickable to dispatch unstuck via existing /api/stuck-detector/unstuck + sound dropdown SelectTrigger width capped at w-40 so long filenames don't blow out the row layout.
- 357c8e4 (this iteration): SQLite-backed persistence for messages-cache + sessions-cache via migration 0004 (messages_cache + sessions_cache tables, MAX_PERSISTED_SESSIONS=1000). setCachedMessages/setCachedSessions write memory + SQLite inline; getStaleMessages/getStaleSessions hydrate from SQLite on memory miss, populating the in-memory LRU so subsequent reads stay fast. Closes the deferred items at the bottom of the 6679f61 commit message ("SQLite-backed cache that survives openportal restart, append-only message semantics that never remove cached items based on a transient empty response"). Plus shrink guard: setCachedMessages/setCachedSessions refuse to overwrite a cached list with a SHORTER one - suspicious partial response per the authoritative-only invariant. Legitimate trims still work because invalidateMessagesCache/invalidateSessionsCache drop the row first; subsequent fetches repopulate from scratch with no shrink check. Plus frontend fix in routes/_app/session/$id.tsx:5270: "OpenCode is unreachable" panel only renders when `messages.length === 0` in addition to `opencodeUnreachable` so a loaded chat log (memory OR SQLite hydrated) no longer gets obscured by the panel. Remaining deferred (would ship if user still sees gaps): append-only per-message merge (today we replace the whole entry on shrink-passing writes; opencode never trims from the middle in practice) and bootstrap-cache.ts (agents/config/providers) SQLite persistence (memory-only today, smaller cold-load impact than messages/sessions).
