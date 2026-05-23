// Per-session messages cache. Polling-mode SWR clients (Settings > Live
// updates = poll, default) repeatedly hit GET
// /api/opencode/<port>/session/<id>/messages every few seconds; without a
// cache each poll round-trips to opencode + re-runs the strip pipeline
// (diagnostics, summary, base64 image rewrites) for the full message
// array. With this cache, repeat polls within TTL serve from memory.
//
// Cache stores ALREADY-STRIPPED data (post-stash + post-strip) so reads
// are zero-copy slice operations. Stripping is what's expensive on
// kotlin-LSP-heavy sessions, not the network round-trip.
//
// Two TTL flavors:
//   - SHORT_TTL_MS (2s): default. Used by the messages handler when it
//     fetches a session on demand. Cache never serves visibly stale data
//     without SSE backing it up.
//   - LONG_LIVED_TTL_MS (5min): used by the session-prefetcher plugin
//     (Section G). The plugin walks all in-flight sessions on a 60s
//     cadence and writes their messages with the long TTL so the cache
//     stays warm. Indicator-broadcaster still invalidates these entries
//     on every delta, so the long TTL is just an upper bound between
//     refreshes - real freshness comes from the SSE invalidation.
//
// Mutations (POST /prompt or /command) call invalidateMessagesCache to
// drop the entry proactively so the next read sees the freshly-arrived
// user message.

interface CacheEntry {
  fetchedAt: number;
  ttlMs: number;
  messages: unknown[];
}

const SHORT_TTL_MS = 2_000;
const LONG_LIVED_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 200;
const cache = new Map<string, CacheEntry>();

function evictIfFull(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

export function getCachedMessages(sessionId: string): unknown[] | null {
  const entry = cache.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > entry.ttlMs) {
    cache.delete(sessionId);
    return null;
  }
  cache.delete(sessionId);
  cache.set(sessionId, entry);
  return entry.messages;
}

export function setCachedMessages(
  sessionId: string,
  messages: unknown[],
): void {
  cache.delete(sessionId);
  cache.set(sessionId, {
    fetchedAt: Date.now(),
    ttlMs: SHORT_TTL_MS,
    messages,
  });
  evictIfFull();
}

export function setCachedMessagesLongLived(
  sessionId: string,
  messages: unknown[],
): void {
  cache.delete(sessionId);
  cache.set(sessionId, {
    fetchedAt: Date.now(),
    ttlMs: LONG_LIVED_TTL_MS,
    messages,
  });
  evictIfFull();
}

export function invalidateMessagesCache(sessionId: string): void {
  cache.delete(sessionId);
}

export function getCachedSessionIds(): string[] {
  return Array.from(cache.keys());
}

// Stale-mode read: returns the cache entry IGNORING TTL. Used as the
// fallback when a fresh fetch from opencode fails (opencode down /
// network blip) so the messages handler can still serve the
// last-known-good list rather than 5xx. Caller is responsible for
// surfacing the staleness to the client (X-OpenPortal-OpenCode-Down
// response header).
export function getStaleMessages(sessionId: string): unknown[] | null {
  const entry = cache.get(sessionId);
  return entry ? entry.messages : null;
}

// Slice messages strictly AFTER the given message id (exclusive). Returns
// null when the marker isn't found in the list - the caller should treat
// that as a stale-since signal and fall back to a full fetch with a
// suitable limit.
export function messagesAfter(
  messages: unknown[],
  sinceMessageId: string,
): unknown[] | null {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as { info?: { id?: string } } | undefined;
    if (m?.info?.id === sinceMessageId) {
      return messages.slice(i + 1);
    }
  }
  return null;
}
