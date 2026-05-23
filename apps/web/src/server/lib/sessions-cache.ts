// Per-port sessions-list cache. Same caching-proxy semantics as
// messages-cache.ts: fresh TTL'd entries serve immediately; stale
// entries (TTL expired but never evicted) serve immediately while a
// background refresh updates the cache; opencode errors NEVER clear
// the cache. User invariant: 'openportal must be a caching proxy
// for opencode... if you see msgid 1 in sesid 1, you cache it!'
//
// The sidebar's project tree is built from this list, so a slow or
// unreachable opencode previously made the sidebar collapse to empty
// (no sessions => no projects). With this cache the sidebar keeps
// rendering whatever sessions opencode last reported, regardless of
// transient slowness.
//
// Invalidated by:
//   - /prompt + /command handlers (new session may have just been
//     created or activity timestamps updated)
//   - session.create / session.delete / session.update SSE events
//     from the indicator broadcaster
//   - explicit invalidateSessionsCache call from refresh button
//
// Per-port keying so a multi-server setup (one openportal pointing
// at multiple opencode instances over time) never crosses streams.

const SHORT_TTL_MS = 30_000;
const MAX_ENTRIES = 32;

interface CacheEntry {
  fetchedAt: number;
  sessions: unknown[];
}

const cache = new Map<number, CacheEntry>();

function evictIfFull(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

export function getCachedSessions(port: number): unknown[] | null {
  const entry = cache.get(port);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > SHORT_TTL_MS) return null;
  cache.delete(port);
  cache.set(port, entry);
  return entry.sessions;
}

export function getStaleSessions(port: number): unknown[] | null {
  const entry = cache.get(port);
  return entry ? entry.sessions : null;
}

export function setCachedSessions(port: number, sessions: unknown[]): void {
  cache.delete(port);
  cache.set(port, { fetchedAt: Date.now(), sessions });
  evictIfFull();
}

export function invalidateSessionsCache(port?: number): void {
  if (port !== undefined) {
    cache.delete(port);
    return;
  }
  cache.clear();
}
