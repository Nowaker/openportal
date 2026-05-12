import { useEffect, useRef } from "react";
import { useSWRConfig } from "swr";

import { useInstanceStore } from "@/stores/instance-store";
import { useActiveStrategy } from "@/hooks/use-active-strategy";
import type { UpdateStrategy } from "@/stores/update-strategy-store";

interface OpencodeEvent {
  type: string;
  properties?: { sessionID?: unknown };
  time?: number;
}

const CHUNKED_FLUSH_MS = 250;

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
export function useEventStream(): void {
  const strategy = useActiveStrategy();
  const port = useInstanceStore((s) => s.instance?.port);
  const { mutate } = useSWRConfig();
  const flushTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    if (strategy === "polling") return;
    if (!port) return;

    const url = `/api/opencode/${port}/event`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      let parsed: OpencodeEvent;
      try {
        parsed = JSON.parse(ev.data) as OpencodeEvent;
      } catch {
        return;
      }
      dispatchEvent(port, parsed, strategy, mutate, flushTimers.current);
    };
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };
    return () => {
      es.close();
      for (const t of flushTimers.current.values()) clearTimeout(t);
      flushTimers.current.clear();
    };
  }, [strategy, port, mutate]);
}

type Mutator = ReturnType<typeof useSWRConfig>["mutate"];

function dispatchEvent(
  port: number,
  e: OpencodeEvent,
  strategy: UpdateStrategy,
  mutate: Mutator,
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
      void mutate(`/api/opencode/${port}/session/status`);
      return;
    case "question.asked":
    case "question.replied":
    case "question.rejected":
      void mutate(`/api/opencode/${port}/questions`);
      return;
    case "permission.asked":
    case "permission.replied":
      void mutate(`/api/opencode/${port}/permissions`);
      return;
    case "session.created":
    case "session.updated":
    case "session.deleted":
    case "session.compacted":
    case "session.error":
      void mutate(`/api/opencode/${port}/sessions`);
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
