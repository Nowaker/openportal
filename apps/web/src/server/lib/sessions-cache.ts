// Per-port sessions-list cache with SQLite persistence (caching proxy).
//
// Same architecture as messages-cache.ts: memory LRU on top of a SQLite
// table (sessions_cache, migration 0004). Survives openportal restart
// so the sidebar project tree never collapses to empty just because the
// process bounced or opencode is slow.
//
// Authoritative-only invariant: setCachedSessions refuses to overwrite
// the cached list with a SHORTER one. Legitimate trims (session.deleted
// SSE event, manual delete) flow through invalidateSessionsCache() which
// drops the entry first so the next fetch repopulates from scratch.
//
// Invalidated by:
//   - /prompt + /command handlers (new session created or activity
//     timestamps updated)
//   - session.create / session.delete / session.update SSE events
//     from the indicator broadcaster
//   - explicit invalidateSessionsCache call from refresh button

import { getPromptDb } from "./prompt-db";

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
  if (entry) return entry.sessions;
  const hydrated = hydrateFromDb(port);
  if (hydrated === null) return null;
  cache.set(port, { fetchedAt: 0, sessions: hydrated });
  evictIfFull();
  return hydrated;
}

export function setCachedSessions(port: number, sessions: unknown[]): void {
  const existing = cache.get(port);
  if (existing && sessions.length < existing.sessions.length) {
    console.warn(
      `[sessions-cache] suspicious shrink for port ${port}: ` +
        `new=${sessions.length} cached=${existing.sessions.length}. ` +
        `Keeping cached data per authoritative-only invariant.`,
    );
    cache.set(port, { fetchedAt: Date.now(), sessions: existing.sessions });
    return;
  }
  cache.delete(port);
  cache.set(port, { fetchedAt: Date.now(), sessions });
  evictIfFull();
  persistToDb(port, sessions);
}

export function invalidateSessionsCache(port?: number): void {
  if (port !== undefined) {
    cache.delete(port);
    deleteFromDb(port);
    return;
  }
  cache.clear();
  deleteAllFromDb();
}

function persistToDb(port: number, sessions: unknown[]): void {
  try {
    const db = getPromptDb();
    const json = JSON.stringify(sessions);
    db.run(
      `INSERT INTO sessions_cache (port, fetched_at, session_count, sessions_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(port) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         session_count = excluded.session_count,
         sessions_json = excluded.sessions_json`,
      [port, Date.now(), sessions.length, json],
    );
  } catch (e) {
    console.warn(
      `[sessions-cache] persist failed for port ${port}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

function hydrateFromDb(port: number): unknown[] | null {
  try {
    const db = getPromptDb();
    const row = db
      .query(`SELECT sessions_json FROM sessions_cache WHERE port = ?`)
      .get(port) as { sessions_json?: string } | null;
    if (!row?.sessions_json) return null;
    const parsed = JSON.parse(row.sessions_json);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    console.warn(
      `[sessions-cache] hydrate failed for port ${port}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

function deleteFromDb(port: number): void {
  try {
    const db = getPromptDb();
    db.run(`DELETE FROM sessions_cache WHERE port = ?`, [port]);
  } catch (e) {
    console.warn(
      `[sessions-cache] delete failed for port ${port}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

function deleteAllFromDb(): void {
  try {
    const db = getPromptDb();
    db.run(`DELETE FROM sessions_cache`);
  } catch (e) {
    console.warn(
      `[sessions-cache] delete-all failed:`,
      e instanceof Error ? e.message : e,
    );
  }
}
