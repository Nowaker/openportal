// Frontend consumer for the backend-pushed indicator state.
//
// One process-wide singleton EventSource subscribes to
// /api/indicators/stream. On connect, we get a full snapshot frame
// (filtered by the open scope), then per-mutation update / remove /
// server-connected / server-disconnected frames as openportal's
// indicator-state mutates.
//
// Why a module-level singleton (not a per-hook EventSource):
//   - The state is process-global on the server; mirroring it
//     per-hook would open N upstream sockets in the browser too.
//   - SWR / React-Query are unsuitable - they expect request/
//     response, not a long-lived stream.
//   - Effects on multiple components subscribing to the same scope
//     should share one socket and one in-memory snapshot.
//
// Consumers call useIndicators(filter) to get the snapshot Map
// scoped to their interest (by serverId and/or sessionId). The hook
// re-renders only when state matching the filter changes, via
// useSyncExternalStore.
//
// Retire-of-polling: useSessionStatus / usePermissions /
// useQuestions in hooks/use-opencode.ts will become thin selectors
// over useIndicators() so the polling hits opencode endpoints can
// stop entirely. This file ships the engine; the selector swaps
// land in follow-up commits.

import { useSyncExternalStore, useMemo } from "react";

import {
  createWatchedEventSource,
  type WatchedEventSource,
} from "@/lib/sse-watchdog";
import { logSystemMessage } from "@/stores/system-messages-store";

const SILENCE_TIMEOUT_MS = 60_000;

export interface IndicatorTodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: string;
}

export interface SessionIndicatorState {
  serverId: string;
  port: number;
  sessionId: string;
  busy: boolean;
  idle: boolean;
  lastEventAt: number;
  lastError: string | null;
  pendingQuestionIds: string[];
  pendingPermissionIds: string[];
  todoState: { pending: number; in_progress: number; completed: number } | null;
  todos: IndicatorTodoItem[] | null;
  pendingPromptIds: string[];
  connected: boolean;
  mode: string | null;
  currentToolName: string | null;
  inFlightAssistantId: string | null;
  // Stuck-detector verdict, merged into the indicator state by the
  // server-side stuck-detector-client plugin. Authoritative source
  // for "is the runner actually doing something" - the opencode
  // event stream (which feeds .busy) can miss message.created and
  // leave .busy stale, so the badge logic falls back to this when
  // .busy is false but the runtime says in-progress.
  stuck_verdict: "idle" | "in-progress" | "stuck" | null;
  stuck_cause: string | null;
  stuck_warnings: string[];
}

type StreamPayload =
  | { type: "snapshot"; sessions: SessionIndicatorState[] }
  | { type: "update"; state: SessionIndicatorState }
  | { type: "remove"; serverId: string; sessionId: string }
  | { type: "server-connected"; serverId: string }
  | { type: "server-disconnected"; serverId: string }
  | { type: "heartbeat"; t: number };

const sessionMap = new Map<string, SessionIndicatorState>();
const listeners = new Set<() => void>();
let connection: WatchedEventSource | null = null;
let snapshotVersion = 0;

function key(serverId: string, sessionId: string): string {
  return `${serverId}::${sessionId}`;
}

function notify(): void {
  snapshotVersion++;
  for (const l of listeners) l();
}

function apply(payload: StreamPayload): void {
  switch (payload.type) {
    case "heartbeat":
      return;
    case "snapshot":
      sessionMap.clear();
      for (const s of payload.sessions) {
        sessionMap.set(key(s.serverId, s.sessionId), s);
      }
      break;
    case "update":
      sessionMap.set(
        key(payload.state.serverId, payload.state.sessionId),
        payload.state,
      );
      break;
    case "remove":
      sessionMap.delete(key(payload.serverId, payload.sessionId));
      break;
    case "server-connected":
    case "server-disconnected": {
      const connected = payload.type === "server-connected";
      for (const [k, s] of sessionMap) {
        if (s.serverId === payload.serverId) {
          sessionMap.set(k, { ...s, connected });
        }
      }
      break;
    }
  }
  notify();
}

function ensureConnection(): void {
  if (typeof window === "undefined") return;
  if (connection) return;
  connection = createWatchedEventSource({
    url: "/api/indicators/stream",
    silenceTimeoutMs: SILENCE_TIMEOUT_MS,
    label: "indicators",
    onMessage: (ev) => {
      try {
        apply(JSON.parse(ev.data) as StreamPayload);
      } catch {
        /* malformed frame; ignore */
      }
    },
    onReconnect: () => {
      logSystemMessage(
        "connection",
        "warning",
        "Indicator stream reconnected (>60s silence)",
        "The /api/indicators/stream SSE feed stopped delivering frames for more than 60s; the client-side watchdog reopened the connection. The next snapshot frame will rebuild indicator state automatically. If this fires repeatedly without obvious cause, your network is dropping the SSE socket silently (wifi handoff, sleep wake, proxy half-close).",
      );
    },
  });
}

export interface IndicatorFilter {
  serverId?: string;
  sessionId?: string;
}

function matches(filter: IndicatorFilter, s: SessionIndicatorState): boolean {
  if (filter.serverId && s.serverId !== filter.serverId) return false;
  if (filter.sessionId && s.sessionId !== filter.sessionId) return false;
  return true;
}

function getSnapshot(filter: IndicatorFilter): SessionIndicatorState[] {
  const out: SessionIndicatorState[] = [];
  for (const s of sessionMap.values()) {
    if (matches(filter, s)) out.push(s);
  }
  return out;
}

// version-keyed proxy. Filtered selectors compare against
// snapshotVersion so any state mutation triggers a re-evaluation.
function subscribe(listener: () => void): () => void {
  ensureConnection();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useIndicators(filter: IndicatorFilter = {}): SessionIndicatorState[] {
  const filterKey = `${filter.serverId ?? ""}::${filter.sessionId ?? ""}`;
  const result = useSyncExternalStore(
    subscribe,
    () => snapshotVersion,
    () => 0,
  );
  // The store snapshot is the version counter (a number) - the actual
  // data is read lazily via useMemo so we only rebuild the filtered
  // array when the version changes OR the filter scope changes.
  return useMemo(() => {
    void result;
    return getSnapshot(filter);
  }, [result, filterKey, filter]);
}

export function useIndicator(
  serverId: string | undefined,
  sessionId: string | undefined,
): SessionIndicatorState | null {
  const list = useIndicators({ serverId, sessionId });
  return list[0] ?? null;
}
