import { createOpencodeClient } from "@opencode-ai/sdk";
import { createOpencodeClient as createOpencodeClientV2 } from "@opencode-ai/sdk/v2/client";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  basicAuthHeader,
  type BasicAuthCreds,
} from "./server-discovery";
import {
  invalidateLiveEndpoint,
  resolveLiveEndpoint,
  type LiveEndpoint,
} from "./server-resolver";
import { getServerByPort } from "./server-registry";

const LEGACY_CONFIG_PATH = join(homedir(), ".portal.json");

const clientCache = new Map<string, ReturnType<typeof createOpencodeClient>>();
const clientCacheV2 = new Map<string, ReturnType<typeof createOpencodeClientV2>>();

interface ResolvedTarget {
  host: string;
  port: number;
  auth?: BasicAuthCreds;
  serverId?: string;
}

// Look up the legacy ~/.portal.json registry by port. Used as a fallback for
// the original "openportal-spawned-its-own-opencode" case so existing users
// don't break when we plug the new server-resolver in front of everything.
function legacyHostnameForPort(port: number): string {
  try {
    if (existsSync(LEGACY_CONFIG_PATH)) {
      const config = JSON.parse(readFileSync(LEGACY_CONFIG_PATH, "utf-8"));
      const instance = config.instances?.find(
        (i: { opencodePort: number }) => i.opencodePort === port,
      );
      if (instance?.hostname && instance.hostname !== "0.0.0.0") {
        return instance.hostname;
      }
    }
  } catch {
    // Fall back to localhost
  }
  return "localhost";
}

// Resolution order for a frontend-supplied `port` handle:
//
//   1. New registry, by stored port. The frontend keys everything by the
//      "stored port" of the active configured server. For ephemeral servers
//      this routes through the resolver, which re-discovers the live
//      endpoint and harvests credentials. The resolver caches; this stays
//      cheap on the hot path.
//   2. Legacy ~/.portal.json. Backward compatibility for the
//      openportal-runs-its-own-opencode flow. No auth, hostname-from-config.
//
// Returns null if the port doesn't resolve. Callers fall back to localhost
// for ultimate safety.
async function resolveTarget(port: number): Promise<ResolvedTarget> {
  const server = getServerByPort(port);
  if (server) {
    const live = await resolveLiveEndpoint(server);
    if (live) {
      return {
        host: live.host,
        port: live.port,
        auth: live.auth,
        serverId: server.id,
      };
    }
    // Server is configured but no live endpoint yet (rediscovery failed).
    // Return its stored host/port so the request can still attempt and
    // surface a real network error to the client.
    return { host: server.host, port: server.port, serverId: server.id };
  }
  return { host: legacyHostnameForPort(port), port };
}

// Public synchronous API: returns the stored hostname for a given port.
// Kept synchronous for compatibility with the existing instances.ts /
// instance/self.ts callers that build URLs without awaiting. For configured
// servers this returns the *stored* host, not the rediscovered live one;
// that's fine because the caller is rendering UI, not making requests.
export function getHostnameForPort(port: number): string {
  const server = getServerByPort(port);
  if (server) return server.host;
  return legacyHostnameForPort(port);
}

// Build a fetch wrapper that injects Basic auth headers. Used for both
// SDK clients and direct proxy fetches. The wrapper is a no-op when auth
// is undefined, so it's safe to use everywhere.
//
// The return type intentionally tracks `typeof fetch` (not just a
// callable signature) so the wrapper plugs into both the v1 SDK
// (Request-only signature) and the v2 SDK (`fetch?: typeof fetch`). The
// v2 SDK's type insists on `preconnect`/etc. being present even though
// it never calls them; we forward those by re-binding the global fetch
// where the wrapper isn't called.
export function makeAuthedFetch(
  auth: BasicAuthCreds | undefined,
): typeof fetch {
  if (!auth) return fetch;
  const header = basicAuthHeader(auth).Authorization;
  const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
    // The SDKs always invoke fetch with a fully-built Request object, but
    // we accept the wider input shape to match `typeof fetch` for callers
    // that pass URL strings (e.g. in tests or future code paths).
    if (input instanceof Request) {
      const headers = new Headers(input.headers);
      if (!headers.has("Authorization")) headers.set("Authorization", header);
      return fetch(new Request(input, { headers }));
    }
    const headers = new Headers(init?.headers);
    if (!headers.has("Authorization")) headers.set("Authorization", header);
    return fetch(input, { ...init, headers });
  }) as typeof fetch;
  // `typeof fetch` includes the static `preconnect` method on Node 22+;
  // forward it to the global so SDK feature detection sees a consistent
  // surface even though we never expect to be called through it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (wrapped as any).preconnect = (fetch as unknown as { preconnect?: unknown })
    .preconnect;
  return wrapped;
}

// Resolve a port to its current live target, including credentials. Async.
// Use this from request handlers that need to forward to opencode.
export async function resolveLiveTarget(port: number): Promise<ResolvedTarget> {
  return resolveTarget(port);
}

// Synthetic 502 used when the upstream opencode is unreachable. Keeps a
// stable shape across `fetchOpencode` and `runSdkCall` so the frontend
// can branch on `{ "error": "upstream-unreachable" }` regardless of
// which proxy path was hit.
function unreachable502(reason: string, port: number): Response {
  return new Response(
    JSON.stringify({
      error: "upstream-unreachable",
      message: reason,
      port,
    }),
    {
      status: 502,
      headers: { "Content-Type": "application/json" },
    },
  );
}

// Convenience: do a fetch against the resolved live target, with the right
// credentials injected. The path is appended to baseUrl as-is (so caller
// supplies a leading slash). Use this for the half-dozen handlers that go
// around the SDK and hit raw endpoints.
//
// On connection refused / 401, automatically retries once after dropping
// the cached live endpoint. This is the ephemeral-port self-healing
// mechanism — opencode-desktop relaunches under a new port and freshly
// minted credentials, our first request fails with ECONNREFUSED, the
// invalidate-and-retry loop picks up the new endpoint via the resolver's
// rediscovery path, and the user sees a single hiccup instead of a
// hung request that needs a manual refresh.
//
// NEVER THROWS. On terminal failure (both attempts errored at the
// transport layer) returns a synthetic 502. Callers can pass the
// Response straight back through the proxy without wrapping in try/catch.
export async function fetchOpencode(
  port: number,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const tryOnce = async (): Promise<Response> => {
    const target = await resolveTarget(port);
    const url = `http://${target.host}:${target.port}${path}`;
    const headers = new Headers(init?.headers);
    if (target.auth && !headers.has("Authorization")) {
      headers.set(
        "Authorization",
        basicAuthHeader(target.auth).Authorization,
      );
    }
    return fetch(url, { ...init, headers });
  };

  let res: Response;
  try {
    res = await tryOnce();
  } catch (e) {
    invalidateForPort(port);
    try {
      return await tryOnce();
    } catch (e2) {
      return unreachable502(
        e2 instanceof Error ? e2.message : "upstream not reachable",
        port,
      );
    }
  }
  // 401 means our cached creds are stale. Drop & retry. The SDK's auth
  // is regenerated on every opencode-desktop relaunch, so a 401 against
  // an ephemeral server is the canonical "they relaunched" signal.
  if (res.status === 401) {
    invalidateForPort(port);
    try {
      return await tryOnce();
    } catch {
      return res;
    }
  }
  return res;
}

// Wrap an SDK call so transport-layer failures (ECONNREFUSED, ETIMEDOUT,
// EHOSTUNREACH, etc.) become a structured 502 instead of an unhandled
// 500. Most handlers do `const client = await getOpencodeClient(port);
// return await client.foo.bar(...)`. Switching to
// `return await runSdkCall(port, () => client.foo.bar(...))` swallows
// network errors and lets non-network errors (HTTP 4xx/5xx returned by
// opencode itself) propagate to Nitro's default error handler.
//
// Distinguishes network errors from real exceptions by looking for the
// telltale Node/Bun error codes. Anything else is rethrown so the
// existing error paths (HTTPError, etc.) keep working.
const NETWORK_ERR_CODES = new Set([
  "ConnectionRefused",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
]);

function isNetworkError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: unknown }).code;
  if (typeof code === "string" && NETWORK_ERR_CODES.has(code)) return true;
  const message = (e as { message?: unknown }).message;
  if (typeof message === "string") {
    if (message.includes("Unable to connect")) return true;
    if (message.includes("connect ECONNREFUSED")) return true;
    if (message.includes("fetch failed")) return true;
  }
  return false;
}

export async function runSdkCall<T>(
  port: number,
  fn: () => Promise<T>,
): Promise<T | Response> {
  try {
    return await fn();
  } catch (e) {
    if (isNetworkError(e)) {
      // Drop the resolver cache so the next call re-resolves (handles
      // ephemeral port shift) and return a structured 502.
      invalidateForPort(port);
      return unreachable502(
        e instanceof Error ? e.message : "upstream not reachable",
        port,
      );
    }
    throw e;
  }
}

// Drop the live-endpoint cache for the server matching this port AND the
// SDK client cache pinned to that endpoint. Call from proxy handlers when
// a request fails with a network error or 401, so the next request
// triggers fresh rediscovery (handles desktop relaunch with a new port +
// new credentials).
//
// SDK client invalidation is critical: cached clients close over the old
// baseUrl and old auth-injecting fetch wrapper, so they keep talking to
// the dead endpoint forever if we only invalidate the resolver cache.
export function invalidateForPort(port: number): void {
  const server = getServerByPort(port);
  if (server) {
    invalidateLiveEndpoint(server.id);
    // Both client caches key by `host:port` of the LIVE endpoint, but
    // because we just invalidated, we don't actually know the previous
    // live host:port anymore. Walking and clearing the whole cache is
    // fine on this hot path; the cache is small (one entry per server)
    // and rebuilding is cheap.
    clientCache.clear();
    clientCacheV2.clear();
  }
}

export async function getOpencodeClient(port: number) {
  const target = await resolveTarget(port);
  const key = `${target.host}:${target.port}`;

  const cached = clientCache.get(key);
  if (cached) return cached;

  const client = createOpencodeClient({
    baseUrl: `http://${target.host}:${target.port}`,
    fetch: makeAuthedFetch(target.auth),
  });

  clientCache.set(key, client);
  return client;
}

export async function getOpencodeClientV2(port: number) {
  const target = await resolveTarget(port);
  const key = `${target.host}:${target.port}`;

  const cached = clientCacheV2.get(key);
  if (cached) return cached;

  const client = createOpencodeClientV2({
    baseUrl: `http://${target.host}:${target.port}`,
    fetch: makeAuthedFetch(target.auth),
  });

  clientCacheV2.set(key, client);
  return client;
}

export async function getOpencodeBaseUrl(port: number): Promise<string> {
  const target = await resolveTarget(port);
  return `http://${target.host}:${target.port}`;
}

// Synchronous variant for code paths that just need a string and don't
// care about ephemeral re-resolution. Returns the stored host:port, never
// the rediscovered one.
export function getOpencodeBaseUrlSync(port: number): string {
  return `http://${getHostnameForPort(port)}:${port}`;
}

export function getInstanceDirectory(port: number): string | undefined {
  try {
    if (existsSync(LEGACY_CONFIG_PATH)) {
      const config = JSON.parse(readFileSync(LEGACY_CONFIG_PATH, "utf-8"));
      const instance = config.instances?.find(
        (i: { opencodePort: number }) => i.opencodePort === port,
      );
      return instance?.directory;
    }
  } catch {}
  return undefined;
}

export function clearClientCache(port?: number) {
  if (port) {
    const target = resolveTargetSync(port);
    const key = `${target.host}:${target.port}`;
    clientCache.delete(key);
    clientCacheV2.delete(key);
  } else {
    clientCache.clear();
    clientCacheV2.clear();
  }
}

// Sync best-effort lookup used only by clearClientCache; fine to skip
// rediscovery here since cache keys are based on stored host:port.
function resolveTargetSync(port: number): ResolvedTarget {
  const server = getServerByPort(port);
  if (server) return { host: server.host, port: server.port, serverId: server.id };
  return { host: legacyHostnameForPort(port), port };
}
