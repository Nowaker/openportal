import { defineHandler, getQuery, setResponseHeader } from "nitro/h3";
import { resolve } from "node:path";
import {
  fetchOpencode,
  getInstanceDirectory,
  getOpencodeClient,
} from "../../lib/opencode-client";
import { parsePort } from "../../lib/validation";
import { readPortalConfig } from "../../lib/portal-config";
import {
  getCachedSessions,
  getStaleSessions,
  sessionsFetchStart,
  type SessionsFetchStart,
  setCachedSessions,
} from "../../lib/sessions-cache";
import { applyOverlay, reconcile } from "../../lib/session-overlay";

type Session = { directory?: string; [k: string]: unknown };

function isUnder(sessionDir: string | undefined, scope: string): boolean {
  if (!sessionDir) return false;
  const s = resolve(scope);
  const d = resolve(sessionDir);
  return d === s || d.startsWith(s + "/");
}

// Single-flight per port and cache generation: multiple concurrent SWR polls
// share one upstream SDK call instead of stacking N requests on a slow
// opencode, but never one that started before the last invalidation.
const INFLIGHT = new Map<string, Promise<Session[]>>();

async function fetchSessionsFromOpencode(port: number): Promise<Session[]> {
  const started = sessionsFetchStart();
  const key = `${port}:${started.generation}`;
  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;
  const promise = doFetchSessions(port, started).finally(() => {
    INFLIGHT.delete(key);
  });
  INFLIGHT.set(key, promise);
  return promise;
}

async function doFetchSessions(
  port: number,
  started: SessionsFetchStart,
): Promise<Session[]> {
  let sessions: Session[];
  try {
    const res = await fetchOpencode(
      port,
      "/experimental/session?archived=true&limit=10000",
    );
    if (res.ok) {
      sessions = (await res.json()) as Session[];
    } else if (res.status === 502) {
      throw new Error("ConnectionRefused");
    } else {
      throw new Error(`upstream ${res.status}`);
    }
  } catch {
    // The SDK returns its errors rather than throwing them. Reading a failed
    // list as `[]` let the shrink guard re-stamp a stale cache as fresh, so an
    // upstream outage looked like a sidebar frozen hours in the past.
    const listed = await (await getOpencodeClient(port)).session.list();
    if (listed.error !== undefined || !Array.isArray(listed.data)) {
      throw new Error("upstream session list failed");
    }
    sessions = listed.data as Session[];
  }
  setCachedSessions(port, sessions, started);
  return sessions;
}

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const query = getQuery(event);

  // Caching-proxy semantics: serve cache (fresh OR stale) immediately,
  // refresh in background. Only block on cold load with no cache. On
  // upstream failure, stale cache stays in place - opencode slowness
  // never clears openportal's view.
  let sessions: Session[] | null = getCachedSessions(port) as Session[] | null;
  if (sessions === null) {
    const stale = getStaleSessions(port) as Session[] | null;
    if (stale !== null) {
      sessions = stale;
      void fetchSessionsFromOpencode(port).catch(() => {
      });
    } else {
      try {
        sessions = await fetchSessionsFromOpencode(port);
      } catch (e) {
        if (
          e instanceof Error &&
          (e.message.includes("ConnectionRefused") ||
            e.message.includes("Unable to connect"))
        ) {
          throw e;
        }
        throw e;
      }
    }
  }

  if (sessions === null) sessions = [];

  // Clear overlay entries that opencode has caught up on, then merge any
  // remaining pending mutations onto each session. The frontend reads
  // `_pendingArchived` / `_pendingTitle` in preference to the raw
  // authoritative fields - see apps/web/src/lib/session-overlay.ts.
  reconcile(port, sessions);
  const overlayed = sessions.map((s) => applyOverlay(port, s));

  const scopes = pickScopes(query, port);
  const filtered =
    !scopes || scopes.length === 0
      ? overlayed
      : overlayed.filter((s) =>
          scopes.some((scope) => isUnder(s.directory, scope)),
        );
  setResponseHeader(event, "X-Sessions-Total", String(overlayed.length));
  return filtered;
});

function pickScopes(
  query: Record<string, unknown>,
  port: number,
): string[] | undefined {
  const explicitScope =
    typeof query.scope === "string" ? query.scope : undefined;
  if (explicitScope === "all") return undefined;

  const explicitDir =
    typeof query.directory === "string" ? query.directory : undefined;
  if (explicitDir) return [explicitDir];

  const portalConfig = readPortalConfig();
  if (portalConfig.directories.length > 0) return portalConfig.directories;

  const instanceDir = getInstanceDirectory(port);
  if (!instanceDir || instanceDir === "/") return undefined;
  return [instanceDir];
}
