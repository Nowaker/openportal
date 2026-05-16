// Per-session messages cache with short TTL. Polling-mode SWR clients
// (Settings > Live updates = poll, default) repeatedly hit GET
// /api/opencode/<port>/session/<id>/messages every few seconds; without a
// cache each poll round-trips to opencode + re-runs the strip pipeline
// (diagnostics, summary, base64 image rewrites) for the full message
// array. With this cache, repeat polls within TTL serve from memory.
//
// Cache stores ALREADY-STRIPPED data (post-stash + post-strip) so reads
// are zero-copy slice operations. Stripping is what's expensive on
// kotlin-LSP-heavy sessions, not the network round-trip.
//
// TTL is intentionally short (2s) so the cache never serves visibly
// stale data without SSE backing it up. Mutations (POST /prompt or
// /command) call invalidateMessagesCache(sessionId) to drop the entry
// proactively so the next read sees the freshly-arrived user message.

interface CacheEntry {
  fetchedAt: number;
  messages: unknown[];
}

const TTL_MS = 2_000;
const MAX_ENTRIES = 50;
const cache = new Map<string, CacheEntry>();

function evictIfFull(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

export function getCachedMessages(sessionId: string): unknown[] | null {
  const entry = cache.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TTL_MS) {
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
    messages,
  });
  evictIfFull();
}

export function invalidateMessagesCache(sessionId: string): void {
  cache.delete(sessionId);
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
