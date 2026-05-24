// Cross-instance prompt routing resolver.
//
// Bug fixed by this module (P0 from the cohort-architecture dispatch):
//   Without owner-resolution, POST /session/<sid>/prompt_async lands on
//   whichever instance the user picked as 'active server'. If a different
//   instance B in the same cohort is already running the live runner for
//   that session, instance A spawns a SECOND parallel runner on the same
//   session ID. Result: two concurrent assistant messages, interleaved
//   part writes, garbled chat, doubled model-API costs. opencode has no
//   cross-instance mutex; the DB doesn't coordinate.
//
// Fix: before every dispatch, ask the stuck-detector plugin who currently
// owns the session's runner. The plugin's authoritative aggregator (per
// opencode-tools 65fbbf2 + 22736c4) is the only thing that knows which
// instance has the live runner across every cohort member sharing the
// SQLite DB.
//
// Flow:
//   1. Cache hit (5s TTL) -> return cached target.
//   2. Cache miss -> GET 127.0.0.1:4098/verdicts/<sid>.
//   3. owner_instance_url non-null -> parse + cache + return.
//   4. owner_instance_url null OR plugin unreachable -> return null,
//      caller routes to its default (user's active-server port).
//      First successful dispatch makes that instance the new owner.
//
// 5s TTL is short so a freshly-changed owner (original instance crashed
// and another picked up) gets re-resolved promptly. The plugin's
// /verdicts/stream broadcasts owner changes; eager invalidation via
// invalidateOwnerCache() is the future hook for that.

import { URL } from "node:url";
import { getOpencodeClient } from "./opencode-client";

const PLUGIN_URL = "http://127.0.0.1:4098";
const RESOLVE_TIMEOUT_MS = 1_500;
const CACHE_TTL_MS = 5_000;

export interface RoutingTarget {
  host: string;
  port: number;
  ownerInstanceUrl: string;
}

interface CacheEntry {
  target: RoutingTarget | null;
  resolvedAt: number;
}

const cache = new Map<string, CacheEntry>();

function parseOwnerUrl(url: unknown): RoutingTarget | null {
  if (typeof url !== "string" || url.length === 0) return null;
  try {
    const u = new URL(url);
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    if (!Number.isFinite(port) || port <= 0) return null;
    return { host: u.hostname, port, ownerInstanceUrl: url };
  } catch {
    return null;
  }
}

async function fetchVerdict(
  sessionId: string,
): Promise<RoutingTarget | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${PLUGIN_URL}/verdicts/${encodeURIComponent(sessionId)}`,
      { signal: ctrl.signal },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn(
        `[prompt-routing] plugin /verdicts/${sessionId} returned ${res.status}`,
      );
      return null;
    }
    const body = (await res.json().catch(() => null)) as
      | { owner_instance_url?: unknown }
      | null;
    return parseOwnerUrl(body?.owner_instance_url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("aborted") && !msg.includes("ECONNREFUSED")) {
      console.warn(`[prompt-routing] plugin lookup failed: ${msg}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveOwner(
  sessionId: string,
): Promise<RoutingTarget | null> {
  const now = Date.now();
  const cached = cache.get(sessionId);
  if (cached && now - cached.resolvedAt < CACHE_TTL_MS) {
    return cached.target;
  }
  const target = await fetchVerdict(sessionId);
  cache.set(sessionId, { target, resolvedAt: Date.now() });
  return target;
}

// Convenience: resolves the owner and returns either an opencode client
// pointing at the owner's port (when known) or one pointing at the
// caller's fallback port (no owner / plugin down). The returned port is
// the one used so callers can log / debug routing decisions.
export async function getOwnerClient(
  sessionId: string,
  fallbackPort: number,
): Promise<{
  client: Awaited<ReturnType<typeof getOpencodeClient>>;
  port: number;
  rerouted: boolean;
}> {
  const owner = await resolveOwner(sessionId);
  if (owner && owner.port !== fallbackPort) {
    return {
      client: await getOpencodeClient(owner.port),
      port: owner.port,
      rerouted: true,
    };
  }
  return {
    client: await getOpencodeClient(fallbackPort),
    port: fallbackPort,
    rerouted: false,
  };
}

export function invalidateOwnerCache(sessionId?: string): void {
  if (sessionId !== undefined) {
    cache.delete(sessionId);
    return;
  }
  cache.clear();
}
