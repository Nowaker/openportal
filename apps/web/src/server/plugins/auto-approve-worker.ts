// Backend auto-approve worker. Opens a server-owned SSE connection to
// each configured opencode server's /event endpoint and watches for
// `permission.asked` events. On match, looks up the effective
// auto-approve setting for the session (override-then-global), and
// when true, fires the reply with `auto: true` so the audit pill
// reflects "auto" provenance.
//
// Lives independent of any browser tab: that is the entire point of
// the refactor. The previous design auto-approved client-side from a
// polling loop, which silently broke whenever the user closed the
// chat tab.
//
// Reconciliation: every 30s the worker enumerates listConfiguredServers()
// and starts/stops per-server connections so newly added servers come
// online without an openportal restart and removed servers free their
// SSE socket.
//
// Reconnect: per-server loop catches stream errors and re-resolves the
// live endpoint (via resolveLiveTarget) before retrying with capped
// exponential backoff. opencode-desktop's port shifts on every relaunch
// are handled transparently.

import { definePlugin } from "nitro";
import {
  buildServerOrigin,
  listConfiguredServers,
} from "../lib/server-registry";
import { resolveLiveEndpointById } from "../lib/server-resolver";
import { basicAuthHeader } from "../lib/server-discovery";
import { getEffectiveAutoApprove } from "../lib/auto-approve-state";
import { replyToPermission } from "../lib/permission-reply";
import { recordAsked } from "../lib/permission-log";
import { fetchOpencode } from "../lib/opencode-client";

const RECONCILE_INTERVAL_MS = 30_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

interface ConnHandle {
  controller: AbortController;
}

const conns = new Map<string, ConnHandle>();

interface PermissionAskedFrame {
  type?: string;
  properties?: { id?: unknown; sessionID?: unknown };
}

interface PendingPermission {
  id?: unknown;
  sessionID?: unknown;
}

function permissionsFromResponse(body: unknown): PendingPermission[] {
  const data =
    body && typeof body === "object" && "data" in body
      ? (body as { data?: unknown }).data
      : body;
  return Array.isArray(data) ? (data as PendingPermission[]) : [];
}

// Drain any permission asks that already arrived in opencode before our SSE
// stream went live. SSE only delivers events fired AFTER subscription, so
// without this every openportal restart leaves prior `permission.asked`
// frames unanswered until the next restart of opencode itself. Caller
// passes a dedup set shared with processStream so a race-window double
// fire (request in both the list snapshot AND the SSE buffer) only sends
// one reply.
async function reconcilePendingPermissions(
  serverId: string,
  port: number,
  signal: AbortSignal,
  alreadyFired: Set<string>,
): Promise<void> {
  if (signal.aborted) return;
  let pending: PendingPermission[];
  try {
    const res = await fetchOpencode(port, "/permission");
    pending = res.ok
      ? permissionsFromResponse(await res.json().catch(() => null))
      : [];
  } catch (err) {
    console.warn(
      `[auto-approve-worker] reconcile list failed (port=${port}):`,
      err instanceof Error ? err.message : err,
    );
    return;
  }
  if (signal.aborted) return;
  let fired = 0;
  for (const p of pending) {
    if (signal.aborted) return;
    if (typeof p.id !== "string" || typeof p.sessionID !== "string") continue;
    recordAsked({ serverId, sessionId: p.sessionID, requestId: p.id });
    if (alreadyFired.has(p.id)) continue;
    if (!getEffectiveAutoApprove(p.sessionID)) continue;
    alreadyFired.add(p.id);
    fired++;
    void replyToPermission(port, p.id, "once", { auto: true }).catch((err) =>
      console.warn(
        `[auto-approve-worker] reconcile reply failed (port=${port} req=${p.id}):`,
        err instanceof Error ? err.message : err,
      ),
    );
  }
  if (fired > 0) {
    console.log(
      `[auto-approve-worker] reconciled ${fired} pending permission(s) on port=${port}`,
    );
  }
}

async function processStream(
  serverId: string,
  port: number,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  alreadyFired: Set<string>,
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
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json) continue;
        try {
          const ev = JSON.parse(json) as PermissionAskedFrame;
          if (
            ev?.type === "permission.asked" &&
            typeof ev.properties?.sessionID === "string" &&
            typeof ev.properties?.id === "string"
          ) {
            const sessionId = ev.properties.sessionID;
            const requestId = ev.properties.id;
            recordAsked({ serverId, sessionId, requestId });
            if (alreadyFired.has(requestId)) continue;
            if (getEffectiveAutoApprove(sessionId)) {
              alreadyFired.add(requestId);
              void replyToPermission(port, requestId, "once", {
                auto: true,
              }).catch((err) =>
                console.warn(
                  `[auto-approve-worker] reply failed (port=${port} req=${requestId}):`,
                  err instanceof Error ? err.message : err,
                ),
              );
            }
          }
        } catch {
          /* malformed frame; ignore */
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
      const url = `${buildServerOrigin(target.protocol, target.host, target.port)}/event`;
      console.log(
        `[auto-approve-worker] connecting server=${serverId} -> ${url}`,
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
      const alreadyFired = new Set<string>();
      await reconcilePendingPermissions(serverId, port, signal, alreadyFired);
      await processStream(serverId, port, res.body, signal, alreadyFired);
      if (signal.aborted) return;
      throw new Error("SSE stream ended");
    } catch (err) {
      if (signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      const delay = Math.min(
        RECONNECT_BASE_DELAY_MS * 2 ** Math.min(retry, 5),
        RECONNECT_MAX_DELAY_MS,
      );
      console.warn(
        `[auto-approve-worker] server=${serverId} disconnected (${msg}); retry in ${delay}ms`,
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
    servers = listConfiguredServers().map((s) => ({ id: s.id, port: s.port }));
  } catch (err) {
    console.warn(
      `[auto-approve-worker] reconcile read failed:`,
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
        `[auto-approve-worker] connection loop crashed for ${srv.id}:`,
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
        `[auto-approve-worker] dropping server=${id} (no longer configured)`,
      );
    }
  }
}

export default definePlugin(() => {
  reconcile();
  const timer = setInterval(reconcile, RECONCILE_INTERVAL_MS);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref?: () => void }).unref?.();
  }
});
