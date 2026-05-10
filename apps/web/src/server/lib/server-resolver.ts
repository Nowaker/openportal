// Server resolver. Bridges the user-facing concept ("server X") with the
// live, possibly-ephemeral endpoint we actually need to talk to. Owns the
// "have we seen the desktop's port shift?" detection and the in-process
// auth cache.
//
// Auth caveat: opencode-desktop generates fresh OPENCODE_SERVER_USERNAME /
// OPENCODE_SERVER_PASSWORD on every relaunch. Persisting them in
// ~/.openportal.json is a foot-gun (human-editable file, secrets, drift)
// so we keep them ONLY in-process and re-harvest from the live process
// env on every cache miss / probe failure.
//
// Caching strategy: per server id, we cache the most recent
// LiveEndpoint. Reads are O(1). On an explicit invalidate (probe fails)
// the cache entry is dropped and the next read does a full re-discovery.

import {
  basicAuthHeader,
  probeOpencode,
  rediscoverEphemeral,
  type BasicAuthCreds,
} from "./server-discovery";
import {
  getServerById,
  updateEphemeralEndpoint,
  type ConfiguredServer,
} from "./server-registry";
import { getAuth } from "./auth-store";

export interface LiveEndpoint {
  host: string;
  port: number;
  auth?: BasicAuthCreds;
}

interface CacheEntry {
  endpoint: LiveEndpoint;
  // For ephemeral entries: time at which this entry stops being trusted
  // and the next read does a fresh re-discovery. Stable entries don't
  // expire (set to Infinity); they only leave the cache via explicit
  // invalidate.
  expiresAt: number;
}

const EPHEMERAL_TTL_MS = 2_000;

const cache = new Map<string, CacheEntry>();

function cacheKey(serverId: string): string {
  return serverId;
}

export function invalidateLiveEndpoint(serverId: string): void {
  cache.delete(cacheKey(serverId));
}

export function invalidateAllLiveEndpoints(): void {
  cache.clear();
}

// Resolve a configured server to its current live endpoint. Strategy:
//
//   - ephemeral=true: re-discover via process scan, but with a short
//     TTL cache (EPHEMERAL_TTL_MS) so a burst of requests share one
//     scan. The TTL is short enough that opencode-desktop relaunches
//     are picked up within a few seconds without manual intervention.
//     Persists the new host:port to the registry when it shifts so the
//     on-disk file stays accurate; auth is in-memory only.
//
//   - ephemeral=false: use the stored host:port as-is, no auth, no
//     probe. The non-ephemeral case is "user told us where the server
//     is, and we trust them". Cached indefinitely (until explicit
//     invalidate). A failed request surfaces as a normal connection
//     error; caller can choose to retry or invalidate.
//
// invalidateLiveEndpoint() forces the next read of either kind to
// re-resolve from scratch.
export async function resolveLiveEndpoint(
  server: ConfiguredServer,
): Promise<LiveEndpoint | null> {
  const key = cacheKey(server.id);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.endpoint;
  }

  if (server.ephemeral) {
    const live = await rediscoverEphemeral(server.discoveryHint);
    if (!live) {
      cache.delete(key);
      return null;
    }
    if (live.host !== server.host || live.port !== server.port) {
      // Persist the new endpoint so the file reflects reality. Auth is
      // intentionally NOT written.
      updateEphemeralEndpoint(server.id, live.host, live.port);
    }
    const endpoint: LiveEndpoint = {
      host: live.host,
      port: live.port,
      auth: live.auth,
    };
    cache.set(key, { endpoint, expiresAt: Date.now() + EPHEMERAL_TTL_MS });
    return endpoint;
  }

  // Non-ephemeral: pull auth from the persistent auth-store. The store
  // is keyed by the registry id, so a server moved or relabelled keeps
  // its credentials. Servers that don't need auth simply have no entry.
  const stored = getAuth(server.id);
  const endpoint: LiveEndpoint = {
    host: server.host,
    port: server.port,
    auth: stored,
  };
  cache.set(key, { endpoint, expiresAt: Number.POSITIVE_INFINITY });
  return endpoint;
}

export async function resolveLiveEndpointById(
  serverId: string,
): Promise<LiveEndpoint | null> {
  const server = getServerById(serverId);
  if (!server) return null;
  return resolveLiveEndpoint(server);
}

// Probe a live endpoint. Convenience wrapper for callers that already have
// a LiveEndpoint and don't want to hand-roll the auth header.
export async function probeLive(
  ep: LiveEndpoint,
  timeoutMs?: number,
): Promise<boolean> {
  return probeOpencode(ep.host, ep.port, ep.auth, timeoutMs);
}

// Build the headers a proxy request needs to talk to a live endpoint.
// Used by the existing /api/opencode/[port]/* handlers when forwarding.
export function liveAuthHeaders(
  ep: LiveEndpoint,
): Record<string, string> {
  return basicAuthHeader(ep.auth);
}
