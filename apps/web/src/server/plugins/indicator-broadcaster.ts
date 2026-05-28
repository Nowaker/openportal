// Indicator broadcaster.
//
// One backend plugin that owns the per-opencode-server SSE subscription
// used for indicator state. Replaces the per-browser /event proxy: the
// browser now opens /api/indicators/stream against openportal and the
// shared SSE state arrives via subscribe() in indicator-state.ts. With
// N browser tabs we hold M upstream connections (one per configured
// opencode server) instead of N*M.
//
// Same lifecycle pattern as auto-approve-worker.ts: reconcile every
// 30s against listConfiguredServers(), one AbortController-managed
// connection per server, exponential reconnect backoff capped at 30s,
// per-frame applyOpencodeEvent() into indicator-state.ts.
//
// Side effects beyond indicator state, by event class:
//
//   * Authoritative removals - message.removed, message.part.removed:
//     invalidateMessagesCache(sessionId). These are the ONLY events
//     that delete cache entries. Per the user's caching-proxy
//     invariant (see AGENTS.md "Caching proxy + authoritative-only
//     invariants"), only authoritative "this is gone" signals may
//     clear the cache.
//
//   * Mutation refreshes - message.part.delta, message.part.updated,
//     message.updated: scheduleRefreshMessages(port, sessionId).
//     These are "this message changed" signals. The cache stays
//     populated and a debounced background refresh repopulates it
//     with the latest authoritative state from opencode. The cache
//     never goes empty for an active session, so the user returning
//     to a session sees the latest content immediately - no
//     blank-window-on-return latency, no synchronous opencode
//     round-trip against a multi-MB session.
//
//   * Session lifecycle - session.created/updated/deleted:
//     invalidateSessionsCache(port). Same authoritative-only logic
//     applied to the sessions list cache.
//
// Initial-state hydration on (re)connect: after the SSE channel
// reopens, we fetch /session/status from opencode and seed the
// indicator state for every session so the dashboard shows accurate
// busy/idle without waiting for a status-change event. We also
// rehydrate pending prompts from SQLite for every session we see so
// queued-but-undelivered virtuals are reflected even before the worker
// re-attempts them.

import { definePlugin } from "nitro";
import { listConfiguredServers } from "../lib/server-registry";
import { resolveLiveEndpointById } from "../lib/server-resolver";
import { basicAuthHeader } from "../lib/server-discovery";
import { invalidateMessagesCache } from "../lib/messages-cache";
import { scheduleRefreshMessages } from "../lib/messages-refresh";
import { invalidateSessionsCache } from "../lib/sessions-cache";
import {
  applyOpencodeEvent,
  setServerConnected,
} from "../lib/indicator-state";

const RECONCILE_INTERVAL_MS = 30_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

// Events that REFRESH the cache: opencode is telling us "this message
// changed" / "a part was streamed in" / "the assistant finalised". The
// cache keeps its current entry; a debounced background fetch lands a
// fresh snapshot within REFRESH_DEBOUNCE_MS so the cache shadows
// opencode reality without the cache ever going empty.
const MESSAGE_REFRESH_EVENTS = new Set<string>([
  "message.part.delta",
  "message.part.updated",
  "message.updated",
]);

// Events that INVALIDATE the cache: authoritative removal. After these,
// the cache MUST drop the entry because the merge logic would otherwise
// resurrect the removed message/part on the next refresh.
const MESSAGE_REMOVAL_EVENTS = new Set<string>([
  "message.part.removed",
  "message.removed",
]);

// Session-lifecycle events from opencode SSE. These are the
// AUTHORITATIVE signal that the sessions list changed - per the
// user's caching-proxy directive, the cache only flips on real
// opencode events, never on timeouts or transient errors.
const SESSION_LIFECYCLE_EVENTS = new Set<string>([
  "session.created",
  "session.updated",
  "session.deleted",
]);

interface ConnHandle {
  controller: AbortController;
}

const conns = new Map<string, ConnHandle>();

// Per-server timestamp of the most recent SSE frame we received from
// opencode. Used by the sidebar SSE-latency metric to surface when
// opencode's SSE pipeline is lagging (LLM-pegged event loop, GC pause,
// upstream restart). 'now - lastEventMs' is the freshness lag.
// null = never connected (process just started, or server never had
//        any traffic). undefined-key = never seen this server.
const lastEventMs = new Map<string, number>();

export function getLastEventMs(serverId: string): number | null {
  const v = lastEventMs.get(serverId);
  return v === undefined ? null : v;
}

export function getAllLastEventMs(): Record<string, number> {
  return Object.fromEntries(lastEventMs);
}

function markEvent(serverId: string): void {
  lastEventMs.set(serverId, Date.now());
}

interface OpencodeFrame {
  type?: string;
  properties?: { sessionID?: unknown };
  time?: number;
}

async function processStream(
  serverId: string,
  port: number,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const dataLine = frame
          .split("\n")
          .find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json) continue;
        let ev: OpencodeFrame;
        try {
          ev = JSON.parse(json) as OpencodeFrame;
        } catch {
          continue;
        }
        markEvent(serverId);
        try {
          applyOpencodeEvent(serverId, port, ev);
          const sid =
            typeof ev.properties?.sessionID === "string"
              ? ev.properties.sessionID
              : null;
          if (ev.type && sid) {
            if (MESSAGE_REMOVAL_EVENTS.has(ev.type)) {
              invalidateMessagesCache(sid);
            } else if (MESSAGE_REFRESH_EVENTS.has(ev.type)) {
              scheduleRefreshMessages(port, sid);
            }
          }
          if (ev.type && SESSION_LIFECYCLE_EVENTS.has(ev.type)) {
            invalidateSessionsCache(port);
          }
        } catch (err) {
          console.warn(
            `[indicator-broadcaster] applyOpencodeEvent threw for server=${serverId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}

async function hydrateFromStatusEndpoint(
  serverId: string,
  port: number,
  host: string,
  upstreamPort: number,
  auth: ReturnType<typeof basicAuthHeader> extends infer T ? T : never,
  signal: AbortSignal,
): Promise<void> {
  try {
    const url = `http://${host}:${upstreamPort}/session/status`;
    const res = await fetch(url, {
      signal,
      headers: { ...basicAuthHeader(auth as Parameters<typeof basicAuthHeader>[0]) },
    });
    if (!res.ok) return;
    const body = (await res.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") return;
    for (const [sessionId, info] of Object.entries(body)) {
      const time = (info as { time?: { completed?: number | null } })?.time;
      const completed =
        time && typeof time === "object"
          ? (time.completed ?? null)
          : undefined;
      applyOpencodeEvent(serverId, port, {
        type: "session.status",
        properties: {
          sessionID: sessionId,
          info: { time: { completed } },
        },
      });
      // TODO: implement rehydratePendingPromptsForSession (see header comment
      // line 42-44 for design intent). The callsite previously threw
      // ReferenceError on every hydration, swallowed by the outer try/catch,
      // aborting the loop after the first session. Disabled until implemented.
    }
  } catch (err) {
    if (!signal.aborted) {
      console.warn(
        `[indicator-broadcaster] hydrate failed server=${serverId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

async function runConnection(
  serverId: string,
  port: number,
  signal: AbortSignal,
): Promise<void> {
  let retry = 0;
  while (!signal.aborted) {
    try {
      const target = await resolveLiveEndpointById(serverId);
      if (!target) {
        throw new Error(`server ${serverId} no longer in registry`);
      }
      const url = `http://${target.host}:${target.port}/event`;
      console.log(
        `[indicator-broadcaster] connecting server=${serverId} port=${port} -> ${url}`,
      );
      const res = await fetch(url, {
        signal,
        headers: {
          Accept: "text/event-stream",
          ...basicAuthHeader(target.auth),
        },
      });
      if (!res.ok || !res.body) {
        throw new Error(`SSE upstream returned ${res.status}`);
      }
      retry = 0;
      setServerConnected(serverId, true);
      void hydrateFromStatusEndpoint(
        serverId,
        port,
        target.host,
        target.port,
        target.auth,
        signal,
      );
      await processStream(serverId, port, res.body, signal);
      setServerConnected(serverId, false);
      if (signal.aborted) return;
      throw new Error("SSE stream ended");
    } catch (err) {
      setServerConnected(serverId, false);
      if (signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      const delay = Math.min(
        RECONNECT_BASE_DELAY_MS * 2 ** Math.min(retry, 5),
        RECONNECT_MAX_DELAY_MS,
      );
      console.warn(
        `[indicator-broadcaster] server=${serverId} disconnected (${msg}); retry in ${delay}ms`,
      );
      try {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, delay);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });
      } catch {
        return;
      }
      retry++;
    }
  }
}

function reconcile(): void {
  let servers: { id: string; port: number }[] = [];
  try {
    servers = listConfiguredServers().map((s) => ({
      id: s.id,
      port: s.port,
    }));
  } catch (err) {
    console.warn(
      `[indicator-broadcaster] reconcile read failed:`,
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const seen = new Set<string>();
  for (const srv of servers) {
    seen.add(srv.id);
    if (conns.has(srv.id)) continue;
    const controller = new AbortController();
    conns.set(srv.id, { controller });
    runConnection(srv.id, srv.port, controller.signal).catch((err) => {
      console.warn(
        `[indicator-broadcaster] connection loop crashed for ${srv.id}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }
  for (const id of [...conns.keys()]) {
    if (!seen.has(id)) {
      const handle = conns.get(id);
      handle?.controller.abort();
      conns.delete(id);
      console.log(
        `[indicator-broadcaster] dropping server=${id} (no longer configured)`,
      );
    }
  }
}

export default definePlugin(() => {
  console.log("[indicator-broadcaster] starting");
  reconcile();
  const timer = setInterval(reconcile, RECONCILE_INTERVAL_MS);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref?: () => void }).unref?.();
  }
});
