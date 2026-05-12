import useSWR from "swr";
import { useInstanceStore } from "@/stores/instance-store";
import { useActiveStrategy } from "@/hooks/use-active-strategy";

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

// Any non-polling strategy puts the SSE event bus in charge of these
// SWR keys (status / questions / permissions / messages). Returning 0
// disables SWR's timer-driven poll. SWR still refetches on focus + on
// mutate() calls from useEventStream.
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

// opencode's GET /session/status returns a map of busy/retry sessions.
// We use a short refresh interval because this is what powers the
// 'Thinking...' indicator's TRUE-busy check - if the indicator is
// telling the user 'still working' but the server says idle, the user
// was misled by a dispatch-failure stuck state and we want to surface
// that within a few seconds, not 60.
export type SessionStatusMap = Record<
  string,
  { type: "busy" | "retry" | "idle" }
>;

export function useSessionStatus() {
  const port = usePort();
  return useSWR<SessionStatusMap>(
    port ? `/api/opencode/${port}/session/status` : null,
    fetcher,
    { refreshInterval: usePollMs(3000), revalidateOnFocus: true },
  );
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

export function usePermissions() {
  const port = usePort();

  return useSWR(
    port ? `/api/opencode/${port}/permissions` : null,
    fetcher,
    { refreshInterval: usePollMs(2000) },
  );
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

export function useQuestions() {
  const port = usePort();

  return useSWR<QuestionRequestSummary[]>(
    port ? `/api/opencode/${port}/questions` : null,
    fetcher,
    { refreshInterval: usePollMs(2000), revalidateOnFocus: true },
  );
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
