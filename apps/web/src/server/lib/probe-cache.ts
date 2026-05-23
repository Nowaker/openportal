import { probeOpencode } from "./server-discovery";
import type { BasicAuthCreds } from "./server-discovery";

// Cached opencode health probes. Without this cache, every browser
// poll of /api/instance/self (every 10s by default; every 2s while
// connection-monitor is in degraded state) fires a fresh probe with
// a 5s socket timeout. On a slow but reachable opencode the probe
// timeout fires before opencode answers, the handler reports
// opencode='down', and the client flips the "OpenCode is unreachable"
// banner. That banner cascades into rendering the chat as
// opencodeUnreachable=true and showing the "Live session messages
// can't load until OpenCode is back" panel - exactly the false-
// negative behaviour the user called out in the caching-proxy
// design directive.
//
// Cache semantics:
//   - UP result cached for UP_TTL_MS. While the cache is fresh, all
//     callers see ok=true immediately, no probe runs.
//   - DOWN result cached for DOWN_TTL_MS (shorter). We want to detect
//     recovery quickly when opencode comes back, so DOWN doesn't
//     stick around for the full UP window.
//   - First call (cold) blocks on the probe so the response is
//     authoritative on a fresh openportal start. Subsequent calls
//     serve from cache + kick off a background refresh past the TTL.
//
// 'AUTHORITATIVELY' (user's word): the cache only flips its verdict
// when a real probe succeeds OR fails. A transient slowness doesn't
// flip the verdict because the probe is non-blocking once the cache
// has any entry.

const UP_TTL_MS = 60_000;
const DOWN_TTL_MS = 5_000;

interface ProbeEntry {
  ok: boolean;
  at: number;
  inflight: Promise<boolean> | null;
}

const cache = new Map<string, ProbeEntry>();

function keyFor(host: string, port: number): string {
  return `${host}:${port}`;
}

export interface CachedProbeResult {
  ok: boolean;
  at: number;
  ageMs: number;
  fromCache: boolean;
}

export async function probeOpencodeCached(
  host: string,
  port: number,
  auth?: BasicAuthCreds,
): Promise<CachedProbeResult> {
  const k = keyFor(host, port);
  const now = Date.now();
  const entry = cache.get(k);

  const ttl = entry?.ok ? UP_TTL_MS : DOWN_TTL_MS;
  const isFresh = entry && now - entry.at < ttl;

  if (entry && isFresh) {
    return { ok: entry.ok, at: entry.at, ageMs: now - entry.at, fromCache: true };
  }

  if (entry && entry.inflight) {
    return { ok: entry.ok, at: entry.at, ageMs: now - entry.at, fromCache: true };
  }

  if (entry && !isFresh) {
    const inflight = (async () => {
      try {
        return await probeOpencode(host, port, auth);
      } catch {
        return false;
      }
    })().then((ok) => {
      cache.set(k, { ok, at: Date.now(), inflight: null });
      return ok;
    });
    cache.set(k, { ...entry, inflight });
    return { ok: entry.ok, at: entry.at, ageMs: now - entry.at, fromCache: true };
  }

  let ok = false;
  try {
    ok = await probeOpencode(host, port, auth);
  } catch {
    ok = false;
  }
  const at = Date.now();
  cache.set(k, { ok, at, inflight: null });
  return { ok, at, ageMs: 0, fromCache: false };
}

export function invalidateProbeCache(host?: string, port?: number): void {
  if (host !== undefined && port !== undefined) {
    cache.delete(keyFor(host, port));
    return;
  }
  cache.clear();
}
