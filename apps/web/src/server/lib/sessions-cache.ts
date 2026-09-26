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
//   - session.created / session.deleted SSE events, and session.updated
//     for a row the list lacks (applySessionEvent; other session.updated
//     frames patch their row in place)
//   - explicit invalidateSessionsCache call from refresh button

import { patchSessionRow } from "../../lib/session-row-patch";
import { getPromptDb } from "./prompt-db";

const SHORT_TTL_MS = 30_000;
const MAX_ENTRIES = 32;
const PERSIST_THROTTLE_MS = 30_000;
const lastPersistMs = new Map<number, number>();

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

// A fetch can start before an SSE frame and finish after it, and must then
// neither undo that frame nor store a list it predates. Invalidations bump a
// generation, and a fetch from an older one is discarded. Row patches are
// replayed onto a fetch that started before them instead, because active
// sessions send session.updated several times a second: discarding every
// fetch they overlap would leave the cache permanently empty.
let generation = 0;
const PATCH_MEMORY_MS = 60_000;
const recentPatches = new Map<number, { at: number; info: object }[]>();

export interface SessionsFetchStart {
  readonly generation: number;
  readonly at: number;
}

export function sessionsFetchStart(): SessionsFetchStart {
  return { generation, at: Date.now() };
}

function replayPatches(port: number, sessions: unknown[], since: number): unknown[] {
  let rows = sessions as object[];
  for (const patch of recentPatches.get(port) ?? []) {
    if (patch.at >= since) rows = patchSessionRow(rows, patch.info) ?? rows;
  }
  return rows;
}

// session.updated carries the whole row, so it patches the cached list in
// place; a row the list does not have yet (a new session) and every other
// lifecycle event invalidate it, and the next GET refetches.
export function applySessionEvent(
  port: number,
  ev: { type?: string; properties?: { info?: unknown } },
): void {
  if (ev.type === "session.updated") {
    const info = ev.properties?.info;
    const entry = cache.get(port);
    const patched = entry ? patchSessionRow(entry.sessions as object[], info) : null;
    if (entry && patched && info && typeof info === "object") {
      const now = Date.now();
      const kept = (recentPatches.get(port) ?? []).filter((p) => now - p.at < PATCH_MEMORY_MS);
      kept.push({ at: now, info });
      recentPatches.set(port, kept);
      entry.sessions = patched;
      return;
    }
    invalidateSessionsCache(port);
    return;
  }
  if (ev.type === "session.created" || ev.type === "session.deleted") {
    invalidateSessionsCache(port);
  }
}

export function setCachedSessions(
  port: number,
  fetched: unknown[],
  startedAt: SessionsFetchStart,
): unknown[] {
  const sessions = replayPatches(port, fetched, startedAt.at);
  if (startedAt.generation !== generation) return sessions;
  const existing = cache.get(port);
  if (existing && sessions.length < existing.sessions.length) {
    console.warn(
      `[sessions-cache] suspicious shrink for port ${port}: ` +
        `new=${sessions.length} cached=${existing.sessions.length}. ` +
        `Keeping cached data per authoritative-only invariant.`,
    );
    cache.set(port, { fetchedAt: Date.now(), sessions: existing.sessions });
    return existing.sessions;
  }
  cache.delete(port);
  cache.set(port, { fetchedAt: Date.now(), sessions });
  evictIfFull();
  persistToDb(port, sessions);
  return sessions;
}

export function invalidateSessionsCache(port?: number): void {
  generation += 1;
  if (port !== undefined) {
    recentPatches.delete(port);
    cache.delete(port);
    deleteFromDb(port);
    return;
  }
  recentPatches.clear();
  cache.clear();
  deleteAllFromDb();
}

function persistToDb(port: number, sessions: unknown[]): void {
  const now = Date.now();
  const last = lastPersistMs.get(port) ?? 0;
  if (now - last < PERSIST_THROTTLE_MS) return;
  lastPersistMs.set(port, now);
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
      [port, now, sessions.length, json],
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
  lastPersistMs.delete(port);
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
  lastPersistMs.clear();
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
