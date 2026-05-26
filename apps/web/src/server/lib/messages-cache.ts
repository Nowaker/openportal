// Per-session messages cache with SQLite persistence (caching proxy).
//
// User directive: 'openportal must be a caching proxy for opencode.
// If you see msgid 1 in sesid 1, you cache it! You know it's there.
// Only when you hear from opencode AUTHORITATIVELY (not a fucking
// timeout or empty array due to a bug or something) that it's not
// there, should you update your cache.'
//
// Two layers:
//   1. In-memory LRU (fast path, TTL'd for fresh reads, untouched for
//      stale reads). Same shape as the pre-persistence implementation.
//   2. SQLite (table messages_cache, migration 0004). The last
//      authoritative opencode response per session. Survives openportal
//      restart so a cold reload while opencode is slow/down still
//      renders the last-known-good chat instead of 'OpenCode is
//      unreachable'.
//
// Write path: setCachedMessages writes memory + SQLite. The SQLite
// write happens INLINE (bun:sqlite is sync); typical payload is small
// after strip-pipeline, and we don't want a fire-and-forget queue
// dropping writes on shutdown.
//
// Read path: getCachedMessages checks memory only (TTL-aware fast
// path). getStaleMessages checks memory first, then SQLite on miss,
// hydrating the in-memory LRU so subsequent reads stay fast.
//
// Shrink guard: setCachedMessages refuses to overwrite a cached list
// with a SHORTER one. Per the authoritative-only invariant, opencode
// returning fewer messages than we have on file is treated as a
// suspicious partial response and ignored. Legitimate trims (revert,
// delete, branch fork) come through invalidateMessagesCache() which
// drops the entry first; subsequent fetches populate from scratch.
//
// Two TTL flavors:
//   - SHORT_TTL_MS (30s): default. Used by the messages handler when
//     it fetches a session on demand.
//   - LONG_LIVED_TTL_MS (5min): used by the session-prefetcher plugin
//     (Section G). The plugin walks all in-flight sessions on a 60s
//     cadence; Indicator-broadcaster invalidates entries on every
//     delta, so the long TTL is just an upper bound between refreshes.
//
// Mutations (POST /prompt or /command) call invalidateMessagesCache to
// drop the entry proactively so the next read sees the freshly-arrived
// user message.

import { getPromptDb } from "./prompt-db";

interface CacheEntry {
  fetchedAt: number;
  ttlMs: number;
  messages: unknown[];
}

const SHORT_TTL_MS = 30_000;
const LONG_LIVED_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 200;
const MAX_PERSISTED_SESSIONS = 1_000;
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

function storeEntry(
  sessionId: string,
  messages: unknown[],
  ttlMs: number,
): void {
  const existing = cache.get(sessionId);
  if (existing && messages.length < existing.messages.length) {
    console.warn(
      `[messages-cache] suspicious shrink for ${sessionId}: ` +
        `new=${messages.length} cached=${existing.messages.length}. ` +
        `Keeping cached data per authoritative-only invariant. ` +
        `Call invalidateMessagesCache(sessionId) explicitly for legitimate trims.`,
    );
    cache.set(sessionId, {
      fetchedAt: Date.now(),
      ttlMs: existing.ttlMs,
      messages: existing.messages,
    });
    return;
  }
  cache.delete(sessionId);
  cache.set(sessionId, { fetchedAt: Date.now(), ttlMs, messages });
  evictIfFull();
  persistToDb(sessionId, messages);
}

export function setCachedMessages(
  sessionId: string,
  messages: unknown[],
): void {
  storeEntry(sessionId, messages, SHORT_TTL_MS);
}

export function setCachedMessagesLongLived(
  sessionId: string,
  messages: unknown[],
): void {
  storeEntry(sessionId, messages, LONG_LIVED_TTL_MS);
}

export function invalidateMessagesCache(sessionId: string): void {
  cache.delete(sessionId);
  deleteFromDb(sessionId);
}

export function getCachedSessionIds(): string[] {
  return Array.from(cache.keys());
}

export function getStaleMessages(sessionId: string): unknown[] | null {
  const entry = cache.get(sessionId);
  if (entry) return entry.messages;
  const hydrated = hydrateFromDb(sessionId);
  if (hydrated === null) return null;
  cache.set(sessionId, {
    fetchedAt: 0,
    ttlMs: SHORT_TTL_MS,
    messages: hydrated,
  });
  evictIfFull();
  return hydrated;
}

function persistToDb(sessionId: string, messages: unknown[]): void {
  try {
    const db = getPromptDb();
    const json = JSON.stringify(messages);
    db.run(
      `INSERT INTO messages_cache (session_id, fetched_at, message_count, messages_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         message_count = excluded.message_count,
         messages_json = excluded.messages_json`,
      [sessionId, Date.now(), messages.length, json],
    );
    db.run(
      `DELETE FROM messages_cache WHERE session_id IN (
         SELECT session_id FROM messages_cache
         ORDER BY fetched_at DESC
         LIMIT -1 OFFSET ?
       )`,
      [MAX_PERSISTED_SESSIONS],
    );
  } catch (e) {
    console.warn(
      `[messages-cache] persist failed for ${sessionId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

function hydrateFromDb(sessionId: string): unknown[] | null {
  try {
    const db = getPromptDb();
    const row = db
      .query(`SELECT messages_json FROM messages_cache WHERE session_id = ?`)
      .get(sessionId) as { messages_json?: string } | null;
    if (!row?.messages_json) return null;
    const parsed = JSON.parse(row.messages_json);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    console.warn(
      `[messages-cache] hydrate failed for ${sessionId}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

function deleteFromDb(sessionId: string): void {
  try {
    const db = getPromptDb();
    db.run(`DELETE FROM messages_cache WHERE session_id = ?`, [sessionId]);
  } catch (e) {
    console.warn(
      `[messages-cache] delete failed for ${sessionId}:`,
      e instanceof Error ? e.message : e,
    );
  }
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
