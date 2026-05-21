# Offline-mode aggressive cache - design doc

User voice (paraphrased): "make open portal basically a fully fully
loadable even if open code server is down ... big cash machine ...
last 100 messages always in the cash ... TTL ... 15 minutes half an
hour or one day ... cash should get hot ... TTL is reset if there is
any access."

Status: **DEFERRED by user voice**: "let's mark this feature for offline
use / aggressive cashing in open portal as deferred. on means it is on
the to-do list but do not implement it continue all your current tasks."

This doc captures the design so when the deferral lifts there's a
starting point.

## Goal

openportal should keep working when opencode is unreachable:
- Sidebar with sessions / projects: cached, browsable.
- Most-recent messages of EVERY recently-viewed session: cached,
  scrollable.
- Pinned-sessions composer: opens, queues prompts locally.
- File browser tree at the last-visited path: cached.

The connection-monitor's existing "opencode-down" banner already
tells the user the live path is broken. The point of the cache is
that the BANNER is the only visible degradation - everything ELSE
keeps working.

## Cache tiers

Three tiers with different TTL + invalidation semantics:

### Tier 1: Always-hot (last 100 messages per session)

For any session the user has VIEWED in the last 7 days, the last
100 messages stay in the cache indefinitely. Invalidation:
- Server confirms a delete / archive / fork: drop the affected
  session.
- Cache size cap (LRU eviction once total cache > N MB).

Storage: IndexedDB keyed by (serverID, sessionID).

### Tier 2: Hot-on-access (15min default TTL, configurable 15min / 30min / 1h / 1d)

For everything else - older messages of viewed sessions, the
sidebar session list, file browser tree contents - cache for the
configured TTL. ANY ACCESS resets the TTL on the entry so
frequently-touched data stays hot indefinitely.

User spec: "TTL is reset if there is any access" - "any" meaning
both reads and writes through openportal. opencode-side updates
that openportal observes via SSE also count as access.

Storage: IndexedDB.

### Tier 3: Best-effort cold

Everything not in tiers 1 or 2. Tries the network first; if the
network fails, returns the stalest cached value with a "stale"
marker so the UI can render a "showing data from <N> ago" hint.

## What goes where

| Resource | Tier | Notes |
|---|---|---|
| Last 100 messages per session | 1 | The user voice spec verbatim |
| Older messages (page 2+) of viewed sessions | 2 | TTL-reset on every load-more click |
| Sidebar session list | 2 | Reset on every sidebar render |
| File browser tree at last-visited path | 2 | Reset on every navigation |
| Settings | 2 | Already persisted in portal-state, but also cached as the API response |
| Auth / credentials / .env | NEVER | Cached secrets are an exfiltration risk |
| Pinned-sessions list | 2 | Reset on every pin/unpin |
| Tools catalog / providers / models | 2 | Slow-changing reference data |

## Write path during offline

When the connection-monitor reports opencode-down:

1. Composer submit -> writes to `localStorage["opencode-pending-prompt:<sid>"]`
   (the existing safety net for in-flight prompts that never made it
   to opencode). The store's existing pending-prompt-worker picks them
   up on reconnect.
2. Mark / unmark star -> write-through to the local starred-messages
   store. Server sync deferred to reconnect.
3. Settings change -> write-through to portal-state (already
   non-blocking for opencode-up status).

## Invalidation on reconnect

When opencode-down -> connected transition fires:

1. Globally `mutate(() => true)` on SWR (already done by
   useConnectionMonitor).
2. Run a reconcile pass over Tier 2 entries: stale entries (TTL
   expired during the offline window) get re-fetched. Hot entries
   (TTL still good) just get a freshness check via ETag /
   last-modified.

## Cache size cap

Default 50 MB. User-configurable in Settings -> Performance:
- 50 MB (default)
- 200 MB (heavy use)
- Unlimited (debug)

LRU eviction by last-access time across all tiers EXCEPT tier 1's
indefinite floor (don't evict the last 100 messages of a viewed
session even if the cache is over cap; instead evict tier 2/3
entries until the floor is the only thing left, then start
evicting tier 1 by last-session-access).

## Implementation phases

Phase 1: tier 1 only. Cache the last 100 messages of any viewed
session in IndexedDB. Surface a "Showing cached messages -
opencode is down" banner when reading from cache. ~2 days.

Phase 2: tier 2 with TTL + reset-on-access. ~3 days.

Phase 3: write-path queuing + reconnect reconcile. ~2 days.

Phase 4: cache-size cap + LRU. ~1 day.

**Total: ~8 days.**

Status: **DEFERRED** - explicit user voice instruction. Documented
here for when the deferral lifts.

## Why this is documented even though deferred

The user's deferral was the right call: this is a significant
architectural change and openportal currently behaves reasonably
when opencode is down (the connection banner shows, the prompts
archive + server list + settings still load - the per-server-down
graceful degradation is already partially in place).

But the design needs to live SOMEWHERE so the deferral doesn't
turn into "we never built this because nobody remembered the
design". Future agents picking up this todo entry should start
here.
