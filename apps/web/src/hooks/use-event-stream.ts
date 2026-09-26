import { useEffect, useRef } from "react";
import { useSWRConfig } from "swr";

import { useInstanceStore } from "@/stores/instance-store";
import { useActiveStrategy } from "@/hooks/use-active-strategy";
import type { UpdateStrategy } from "@/stores/update-strategy-store";
import { createWatchedEventSource } from "@/lib/sse-watchdog";
import { logSystemMessage } from "@/stores/system-messages-store";
import { patchSessionRow } from "@/lib/session-row-patch";

interface OpencodeEvent {
  type: string;
  properties?: { sessionID?: unknown; info?: unknown };
  time?: number;
}

const CHUNKED_FLUSH_MS = 250;
const SILENCE_TIMEOUT_MS = 60_000;

// Subscribes to /api/opencode/<port>/event (Portal's SSE proxy of opencode's
// /event endpoint) and dispatches each event to SWR cache mutations. The
// strategy decides which event categories cause refetches and (for delta
// events) how aggressively to throttle them:
//
//   polling  - never connects to SSE at all
//   snapshot - listens for message.updated + part snapshot/removed events
//              only, ignoring per-token delta events
//   chunked  - same as snapshot, plus part.delta events throttled to a
//              250ms window per session (one refetch per session per
//              window even if 500 delta events arrived)
//   asap     - listens to every message event including part.delta and
//              invalidates on each one immediately
//
// Why per-key mutate vs. global mutate(()=>true): a single delta event on
// a long-running session would otherwise refetch every SWR entry in the
// app, including heavy /messages?limit=50 calls for sessions the user
// isn't even looking at.
//
// Indicator-state events (session.status / session.idle / question.*
// / permission.*) are intentionally NOT dispatched here as of Phase C
// of the SSE indicator rework. The indicator-broadcaster plugin on the
// server consumes those same events and fans them out via
// /api/indicators/stream to useIndicators(); the SWR keys these used
// to refresh (/session/status, /questions, /permissions) are no longer
// populated by any hook. The cases below short-circuit explicitly so
// the matrix is self-documenting next to the message branches.
export function useEventStream(): void {
  const strategy = useActiveStrategy();
  const port = useInstanceStore((s) => s.instance?.port);
  const { mutate, cache } = useSWRConfig();
  const flushTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    if (strategy === "polling") return;
    if (!port) return;

    const url = `/api/opencode/${port}/event`;
    const portPrefix = `/api/opencode/${port}/`;
    const watched = createWatchedEventSource({
      url,
      silenceTimeoutMs: SILENCE_TIMEOUT_MS,
      label: `opencode-events:${port}`,
      onMessage: (ev) => {
        let parsed: OpencodeEvent;
        try {
          parsed = JSON.parse(ev.data) as OpencodeEvent;
        } catch {
          return;
        }
        dispatchEvent(port, parsed, strategy, mutate, cache, flushTimers.current);
      },
      onReconnect: () => {
        for (const t of flushTimers.current.values()) clearTimeout(t);
        flushTimers.current.clear();
        void mutate(
          (key) => typeof key === "string" && key.startsWith(portPrefix),
        );
        logSystemMessage(
          "connection",
          "warning",
          "OpenCode event stream reconnected (>60s silence)",
          `The opencode /event SSE proxy stopped delivering frames for more than 60s; the client-side watchdog reopened the connection and refreshed SWR data for port ${port}. If this fires repeatedly without obvious cause, your network is dropping the SSE socket silently (wifi handoff, sleep wake, proxy half-close).`,
        );
      },
    });
    return () => {
      watched.close();
      for (const t of flushTimers.current.values()) clearTimeout(t);
      flushTimers.current.clear();
    };
  }, [strategy, port, mutate, cache]);
}

type Mutator = ReturnType<typeof useSWRConfig>["mutate"];
type SwrCache = ReturnType<typeof useSWRConfig>["cache"];

function dispatchEvent(
  port: number,
  e: OpencodeEvent,
  strategy: UpdateStrategy,
  mutate: Mutator,
  cache: SwrCache,
  flushTimers: Map<string, ReturnType<typeof setTimeout>>,
): void {
  const sid =
    typeof e.properties?.sessionID === "string"
      ? e.properties.sessionID
      : null;

  switch (e.type) {
    case "message.updated":
    case "message.part.updated":
    case "message.part.removed":
    case "message.removed":
    case "todo.updated":
      if (sid) invalidateMessages(port, sid, mutate);
      return;

    case "message.part.delta":
      if (!sid) return;
      if (strategy === "snapshot") return;
      if (strategy === "asap") {
        invalidateMessages(port, sid, mutate);
        return;
      }
      // chunked: coalesce into a 250ms window per session
      if (flushTimers.has(sid)) return;
      const timer = setTimeout(() => {
        flushTimers.delete(sid);
        invalidateMessages(port, sid, mutate);
      }, CHUNKED_FLUSH_MS);
      flushTimers.set(sid, timer);
      return;

    case "session.status":
    case "session.idle":
    case "question.asked":
    case "question.replied":
    case "question.rejected":
    case "permission.asked":
    case "permission.replied":
      return;
    case "session.updated":
      patchSessionLists(port, e.properties?.info, mutate, cache);
      return;
    case "session.created":
    case "session.deleted":
    case "session.compacted":
    case "session.error":
      for (const key of sessionListKeys(port, cache)) void mutate(key);
      return;
    default:
      return;
  }
}

function invalidateMessages(
  port: number,
  sessionID: string,
  mutate: Mutator,
): void {
  const prefix = `/api/opencode/${port}/session/${sessionID}/messages`;
  void mutate(
    (key) => typeof key === "string" && key.startsWith(prefix),
  );
}

// Every cached sessions list for this port: the sidebar's `/sessions` and the
// Ctrl+K palette's `/sessions?scope=all` are separate SWR keys.
function sessionListKeys(port: number, cache: SwrCache): string[] {
  const base = `/api/opencode/${port}/sessions`;
  return [...cache.keys()].filter(
    (key): key is string =>
      typeof key === "string" && (key === base || key.startsWith(`${base}?`)),
  );
}

// session.updated carries the whole row, so a rename or archive is applied to
// each cached list without refetching thousands of sessions (2-4s measured).
// A list that lacks the row - a session it has never seen - is refetched.
function patchSessionLists(
  port: number,
  info: unknown,
  mutate: Mutator,
  cache: SwrCache,
): void {
  for (const key of sessionListKeys(port, cache)) {
    const rows: unknown = cache.get(key)?.data;
    const patched = Array.isArray(rows) ? patchSessionRow(rows as object[], info) : null;
    if (patched) void mutate(key, patched, { revalidate: false });
    else void mutate(key);
  }
}
