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
  setCachedSessions,
} from "../../lib/sessions-cache";

type Session = { directory?: string; [k: string]: unknown };

function isUnder(sessionDir: string | undefined, scope: string): boolean {
  if (!sessionDir) return false;
  const s = resolve(scope);
  const d = resolve(sessionDir);
  return d === s || d.startsWith(s + "/");
}

// Single-flight per port: multiple concurrent SWR polls share one
// upstream SDK call instead of stacking N requests on a slow opencode.
const INFLIGHT = new Map<number, Promise<Session[]>>();

async function fetchSessionsFromOpencode(port: number): Promise<Session[]> {
  const inflight = INFLIGHT.get(port);
  if (inflight) return inflight;
  const promise = doFetchSessions(port).finally(() => {
    INFLIGHT.delete(port);
  });
  INFLIGHT.set(port, promise);
  return promise;
}

async function doFetchSessions(port: number): Promise<Session[]> {
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
    sessions = (((await (await getOpencodeClient(port)).session.list()).data ?? [])) as Session[];
  }
  setCachedSessions(port, sessions);
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

  const scopes = pickScopes(query, port);
  const filtered =
    !scopes || scopes.length === 0
      ? sessions
      : sessions.filter((s) =>
          scopes.some((scope) => isUnder(s.directory, scope)),
        );
  setResponseHeader(event, "X-Sessions-Total", String(sessions.length));
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
