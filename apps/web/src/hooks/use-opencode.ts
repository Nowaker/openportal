import { useMemo } from "react";
import useSWR from "swr";
import { useInstanceStore } from "@/stores/instance-store";
import { useActiveStrategy } from "@/hooks/use-active-strategy";
import {
  useIndicator,
  useIndicators,
  type IndicatorTodoItem,
  type SessionIndicatorState,
} from "@/hooks/use-indicators";
import type { TodoItem, TodoSnapshot, TodoStatus } from "@/lib/todos";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
};

function usePort() {
  const instance = useInstanceStore((s) => s.instance);
  return instance?.port ?? null;
}

function useServerId(): string | undefined {
  const instance = useInstanceStore((s) => s.instance);
  return instance?.id;
}

// Legacy knob kept for hooks that haven't yet migrated to the SSE
// indicator stream (chat /messages still uses SWR + event-stream
// invalidation). The three indicator-source hooks below no longer
// touch this - their polling is GONE, replaced by useIndicators().
export function usePollMs(intervalMs: number): number {
  const strategy = useActiveStrategy();
  return strategy === "polling" ? intervalMs : 0;
}

export function useInstances() {
  return useSWR("/api/instances", fetcher);
}

export interface PortalConfigResponse {
  directories: string[];
  baseDirs: { path: string; level: number; level1: string[] }[];
  drops: { path: string; reason: string }[];
  home: string;
}

export function usePortalConfig() {
  return useSWR<PortalConfigResponse>("/api/config/portal", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
}

export function useProjectPaths() {
  return useSWR<{ paths: string[]; errors: { base: string; error: string }[] }>(
    "/api/fs/projects",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
}

export interface SelfInstance {
  id: string;
  name: string;
  directory: string;
  port: number;
  hostname: string;
}

export function useSelfInstance() {
  return useSWR<{ instance: SelfInstance | null; error?: string }>(
    "/api/instance/self",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
}

export function useSessions() {
  const port = usePort();

  return useSWR(port ? `/api/opencode/${port}/sessions` : null, fetcher);
}

export function useSession(id: string | null) {
  const port = usePort();

  return useSWR(
    port && id ? `/api/opencode/${port}/session/${id}` : null,
    fetcher,
  );
}

// Phase C of the SSE indicator rework (engine: 8daa54c, backend:
// e89f528). useSessionStatus used to poll
// /api/opencode/<port>/session/status every 3s. That poll is GONE -
// the busy/idle map is now derived from the singleton
// /api/indicators/stream subscription via useIndicators().
//
// Return shape preserved: { data: SessionStatusMap } where each entry
// has { type: "busy" | "retry" | "idle" }. Consumers in
// app-sidebar.tsx, app-sidebar-nav.tsx, and routes/_app/session/$id.tsx
// destructure { data: statusMap } and read `.type` - no callsite
// changes needed.
//
// "retry" no longer surfaces: the indicator-state singleton on the
// server doesn't classify retries separately (the legacy
// /session/status endpoint did, by inspecting opencode's per-message
// retry hints). For the indicator dot this is fine - "retry" was
// always treated as a busy state by consumers, so collapsing it into
// "busy" preserves the visible UI behavior.
export type SessionStatusMap = Record<
  string,
  { type: "busy" | "retry" | "idle" }
>;

function toStatus(s: SessionIndicatorState): { type: "busy" | "idle" } {
  return { type: s.busy ? "busy" : "idle" };
}

export function useSessionStatus(): {
  data: SessionStatusMap;
  isLoading: boolean;
  error: undefined;
  mutate: typeof noopMutate;
} {
  const instance = useInstanceStore((s) => s.instance);
  const serverId = instance?.id;
  const states = useIndicators(serverId ? { serverId } : {});
  const data = useMemo<SessionStatusMap>(() => {
    if (!serverId) return {};
    const out: SessionStatusMap = {};
    for (const s of states) {
      out[s.sessionId] = toStatus(s);
    }
    return out;
  }, [states, serverId]);
  return { data, isLoading: false, error: undefined, mutate: noopMutate };
}

// Shared no-op so callsites that destructure `.mutate()` get a
// defined function. No SWR cache to revalidate - the SSE stream owns
// the data.
const noopMutate = async (): Promise<undefined> => undefined;

// Replaces the legacy `extractLatestTodos(messages)` derivation, which
// scanned the message stream for the latest todowrite tool-call and
// broke once a session grew past the 50-message tail window (the part
// drifted out of range, sidebar/strip went blank).
//
// Data flows: indicator-state.todos (live, SSE-pushed on
// `todo.updated`) wins when present. On cold open of a session that
// hasn't emitted `todo.updated` since the broadcaster started, SWR
// fetches `/api/opencode/<port>/session/<id>/todo` once (no polling,
// `refreshInterval: 0`); the proxy reads from opencode's TodoTable
// SQLite directly, so even months-old idle sessions return their
// canonical list.
export function useTodos(sessionId: string | null): {
  data: TodoSnapshot | null;
  isLoading: boolean;
} {
  const port = usePort();
  const serverId = useServerId();
  const indicator = useIndicator(serverId, sessionId ?? undefined);
  const indicatorTodos = indicator?.todos ?? null;

  const swrKey =
    port && sessionId && indicatorTodos === null
      ? `/api/opencode/${port}/session/${sessionId}/todo`
      : null;
  const { data: fetched, isLoading } = useSWR<IndicatorTodoItem[]>(
    swrKey,
    fetcher,
    { refreshInterval: 0, revalidateOnFocus: false },
  );

  const data = useMemo<TodoSnapshot | null>(() => {
    const source = indicatorTodos ?? fetched ?? null;
    if (!source || source.length === 0) return null;
    const items: TodoItem[] = source.map((t, idx) => ({
      id: `${idx}-${t.content}`,
      content: t.content,
      status: t.status as TodoStatus,
    }));
    return {
      todos: items,
      updatedAt: indicator?.lastEventAt ?? Date.now(),
      toolPartId: "todotable",
    };
  }, [indicatorTodos, fetched, indicator?.lastEventAt]);

  return { data, isLoading };
}

export interface QuestionRequestSummary {
  id: string;
  sessionID: string;
}

export function useSessionMessages(id: string | null) {
  const port = usePort();

  return useSWR(
    port && id ? `/api/opencode/${port}/session/${id}/messages` : null,
    fetcher,
  );
}

export function useConfig() {
  const port = usePort();

  return useSWR(port ? `/api/opencode/${port}/config` : null, fetcher);
}

export function useProviders() {
  const port = usePort();

  return useSWR(port ? `/api/opencode/${port}/providers` : null, fetcher);
}

export function useAgents() {
  const port = usePort();

  return useSWR(port ? `/api/opencode/${port}/agents` : null, fetcher);
}

export function useHealth() {
  const port = usePort();

  return useSWR(port ? `/api/opencode/${port}/health` : null, fetcher);
}

export function useCurrentProject() {
  const port = usePort();

  return useSWR(port ? `/api/opencode/${port}/project/current` : null, fetcher);
}

export function useHostname() {
  return useSWR("/api/system/hostname", fetcher);
}

export interface CreateSessionOptions {
  title?: string;
  directory?: string;
  parentID?: string;
}

export function useCreateSession() {
  const port = usePort();

  return async (opts?: CreateSessionOptions | string) => {
    if (!port) throw new Error("No instance selected");

    const body: CreateSessionOptions =
      typeof opts === "string" ? { title: opts } : (opts ?? {});

    const res = await fetch(`/api/opencode/${port}/session/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Failed to create session: ${res.status}`);
    }

    return res.json();
  };
}

export function useDeleteSession() {
  const port = usePort();

  return async (sessionId: string) => {
    if (!port) throw new Error("No instance selected");

    const res = await fetch(`/api/opencode/${port}/session/${sessionId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      throw new Error(`Failed to delete session: ${res.status}`);
    }

    return res.json();
  };
}

export function useArchiveSession() {
  const port = usePort();
  return async (sessionId: string) => {
    if (!port) throw new Error("No instance selected");
    const res = await fetch(
      `/api/opencode/${port}/session/${sessionId}/archive`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error(`Failed to archive session: ${res.status}`);
    return res.json();
  };
}

export function useUnarchiveSession() {
  const port = usePort();
  return async (sessionId: string) => {
    if (!port) throw new Error("No instance selected");
    const res = await fetch(
      `/api/opencode/${port}/session/${sessionId}/unarchive`,
      { method: "POST" },
    );
    if (!res.ok)
      throw new Error(`Failed to unarchive session: ${res.status}`);
    return res.json();
  };
}

export function useGitDiff() {
  const port = usePort();

  return useSWR<{ diff: string; worktree: string }>(
    port ? `/api/opencode/${port}/git/diff` : null,
    fetcher,
  );
}

// Phase C: permissions list comes from the indicator-state singleton,
// not the 2s poll against /api/opencode/<port>/permissions. The
// indicator-state stream carries `pendingPermissionIds: string[]` per
// session; we flatten into the legacy `{ id, sessionID }[]` shape so
// the two sidebar consumers (app-sidebar.tsx, app-sidebar-nav.tsx)
// keep working unchanged.
//
// The full permission object (with action / call / metadata) is NOT
// reconstructable from the indicator stream - only the IDs and their
// owning sessionID are tracked. None of the current callsites read
// any other field, so this is sufficient. If a future consumer needs
// the full object, it should fetch /api/opencode/<port>/permissions
// on-demand (one-shot, not polled) when the permission is selected
// for display, not on every list render.
export interface PermissionRequestSummary {
  id: string;
  sessionID: string;
}

export function usePermissions(): {
  data: PermissionRequestSummary[];
  isLoading: boolean;
  error: undefined;
  mutate: typeof noopMutate;
} {
  const instance = useInstanceStore((s) => s.instance);
  const serverId = instance?.id;
  const states = useIndicators(serverId ? { serverId } : {});
  const data = useMemo<PermissionRequestSummary[]>(() => {
    if (!serverId) return [];
    const out: PermissionRequestSummary[] = [];
    for (const s of states) {
      for (const id of s.pendingPermissionIds) {
        out.push({ id, sessionID: s.sessionId });
      }
    }
    return out;
  }, [states, serverId]);
  return { data, isLoading: false, error: undefined, mutate: noopMutate };
}

export function useReplyPermission() {
  const port = usePort();

  return async (requestId: string, reply: "once" | "always" | "reject", message?: string) => {
    if (!port) throw new Error("No instance selected");

    const res = await fetch(`/api/opencode/${port}/permission/${requestId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply, message }),
    });

    if (!res.ok) {
      throw new Error(`Failed to reply to permission: ${res.status}`);
    }

    return res.json();
  };
}

// Phase C: question list comes from the indicator-state singleton,
// not the 2s poll against /api/opencode/<port>/questions. Same
// flattening pattern as usePermissions above. Consumers see
// QuestionRequestSummary[] just like before.
export function useQuestions(): {
  data: QuestionRequestSummary[];
  isLoading: boolean;
  error: undefined;
  mutate: typeof noopMutate;
} {
  const instance = useInstanceStore((s) => s.instance);
  const serverId = instance?.id;
  const states = useIndicators(serverId ? { serverId } : {});
  const data = useMemo<QuestionRequestSummary[]>(() => {
    if (!serverId) return [];
    const out: QuestionRequestSummary[] = [];
    for (const s of states) {
      for (const id of s.pendingQuestionIds) {
        out.push({ id, sessionID: s.sessionId });
      }
    }
    return out;
  }, [states, serverId]);
  return { data, isLoading: false, error: undefined, mutate: noopMutate };
}

export function useReplyQuestion() {
  const port = usePort();

  return async (requestId: string, answers: Array<{ values: string[] }>) => {
    if (!port) throw new Error("No instance selected");

    const res = await fetch(`/api/opencode/${port}/question/${requestId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });

    if (!res.ok) {
      throw new Error(`Failed to reply to question: ${res.status}`);
    }

    return res.json();
  };
}

export function useRejectQuestion() {
  const port = usePort();

  return async (requestId: string) => {
    if (!port) throw new Error("No instance selected");

    const res = await fetch(`/api/opencode/${port}/question/${requestId}/reject`, {
      method: "POST",
    });

    if (!res.ok) {
      throw new Error(`Failed to reject question: ${res.status}`);
    }

    return res.json();
  };
}

export function useAbortSession() {
  const port = usePort();

  return async (sessionId: string) => {
    if (!port) throw new Error("No instance selected");

    const res = await fetch(`/api/opencode/${port}/session/${sessionId}/abort`, {
      method: "POST",
    });

    if (!res.ok) {
      throw new Error(`Failed to abort session: ${res.status}`);
    }

    return res.json();
  };
}
