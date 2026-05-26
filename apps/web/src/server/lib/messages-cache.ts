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
// Per-session throttle for SQLite writes. The 12k-message session's
// JSON is ~35 MB; without throttling, SWR poll cadence + SSE-triggered
// revalidations would write tens of MB to disk per second, block the
// Bun event loop, and cascade into browser per-host connection-pool
// exhaustion (ERR_INSUFFICIENT_RESOURCES). 30 s is enough to keep the
// SQLite copy 'fresh enough' for restart-survival without thrashing.
const PERSIST_THROTTLE_MS = 30_000;
const lastPersistMs = new Map<string, number>();
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
  const merged = mergeByMessageId(existing?.messages ?? [], messages);
  cache.delete(sessionId);
  cache.set(sessionId, { fetchedAt: Date.now(), ttlMs, messages: merged });
  evictIfFull();
  persistToDb(sessionId, merged);
}

// Append-only merge: new messages from opencode REPLACE existing
// entries with the same info.id (content may have grown - streaming
// parts arrive incrementally), but existing entries NOT in the new
// list are KEPT with `_reconciling: true` set on info. This protects
// against opencode returning a stale-but-same-length snapshot that
// would otherwise overwrite a message we just authoritatively received.
//
// User invariant (verbatim, #68 in AI_TODO.md): 'MUST be aware that
// opencode has latency and sometimes a list of messages comes back
// and it's out of date with our submission. so openportal must
// ALWAYS be aware of that, and keep anything that opencode confirmed
// as received, but not yet coming back to us with a certain badge.'
//
// Legitimate trims (revert / delete / session.deleted SSE) flow
// through invalidateMessagesCache() which drops the whole cache
// entry. Subsequent fetches repopulate from scratch with no merge.
// The merge only triggers on a fresh setCachedMessages call when the
// cache already has data - i.e. the SWR poll cycle.
function mergeByMessageId(
  existing: unknown[],
  fresh: unknown[],
): unknown[] {
  if (existing.length === 0) return fresh;
  const freshIds = new Set<string>();
  for (const m of fresh) {
    const id = messageIdOf(m);
    if (id) freshIds.add(id);
  }
  const reconciling: unknown[] = [];
  for (const m of existing) {
    const id = messageIdOf(m);
    if (!id) continue;
    if (freshIds.has(id)) continue;
    reconciling.push(markReconciling(m));
  }
  if (reconciling.length === 0) return fresh;
  const out = [...fresh, ...reconciling];
  out.sort(byTimeCreated);
  return out;
}

function messageIdOf(m: unknown): string | null {
  if (!m || typeof m !== "object") return null;
  const id = (m as { info?: { id?: unknown } }).info?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function markReconciling(m: unknown): unknown {
  if (!m || typeof m !== "object") return m;
  const obj = m as { info?: Record<string, unknown> };
  if (obj.info && obj.info._reconciling === true) return m;
  return {
    ...m,
    info: { ...(obj.info ?? {}), _reconciling: true },
  };
}

function byTimeCreated(a: unknown, b: unknown): number {
  const ta =
    (a as { info?: { time?: { created?: number } } }).info?.time?.created ?? 0;
  const tb =
    (b as { info?: { time?: { created?: number } } }).info?.time?.created ?? 0;
  return ta - tb;
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
  const now = Date.now();
  const last = lastPersistMs.get(sessionId) ?? 0;
  if (now - last < PERSIST_THROTTLE_MS) return;
  lastPersistMs.set(sessionId, now);
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
      [sessionId, now, messages.length, json],
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
  lastPersistMs.delete(sessionId);
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
