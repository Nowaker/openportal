import { defineHandler, setResponseHeader } from "nitro/h3";
import { getOpencodeClient } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";
import {
  getCachedSessions,
  getStaleSessions,
} from "../../../../lib/sessions-cache";

interface SessionLite {
  id?: string;
  [k: string]: unknown;
}

// Caching-proxy fast path: single-session GET serves from the sessions-
// list cache when possible. The sessions-cache already holds every
// session metadata (the list endpoint populated it), so a single-session
// lookup is typically a free O(N) scan of cached entries with no
// opencode round-trip. Only falls back to the SDK call when the cache
// has no record of this ID (brand-new session, or LRU evicted).
// User invariant: 'maintain your own view of the world, and update it
// as opencode is giving you modifications.'
function lookupCached(port: number, id: string): SessionLite | null {
  const fresh = getCachedSessions(port) as SessionLite[] | null;
  if (fresh) {
    const hit = fresh.find((s) => s?.id === id);
    if (hit) return hit;
  }
  const stale = getStaleSessions(port) as SessionLite[] | null;
  if (stale) {
    const hit = stale.find((s) => s?.id === id);
    if (hit) return hit;
  }
  return null;
}

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");

  const cached = lookupCached(port, id);
  if (cached) {
    setResponseHeader(event, "X-OpenPortal-Session-Source", "sessions-cache");
    return cached;
  }

  const client = await getOpencodeClient(port);
  const session = await client.session.get({ path: { id } });
  setResponseHeader(event, "X-OpenPortal-Session-Source", "opencode-sdk");
  return session.data;
});
