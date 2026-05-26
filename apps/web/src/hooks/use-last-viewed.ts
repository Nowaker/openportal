import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { usePollMs } from "@/hooks/use-opencode";

const KEY = "/api/state/last-viewed";
// Per-session throttle for the POST /api/state/last-viewed call.
// Without this, busy sessions with streaming SSE updates re-fire the
// mark-viewed effect on every render, hitting 20-40 POSTs/sec - which
// piles up in the browser's per-host connection pool and trips
// ERR_INSUFFICIENT_RESOURCES once the server's event loop is busy.
const MARK_VIEWED_THROTTLE_MS = 5_000;
const lastMarkedMs = new Map<string, number>();

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

export function useLastViewed() {
  const pollMs = usePollMs(5000);
  return useSWR<Record<string, number>>(KEY, fetcher, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: pollMs,
    keepPreviousData: true,
  });
}

export function useMarkViewed() {
  const { mutate } = useSWRConfig();
  return useCallback(
    async (sessionId: string, ms: number = Date.now()) => {
      const now = Date.now();
      const last = lastMarkedMs.get(sessionId) ?? 0;
      if (now - last < MARK_VIEWED_THROTTLE_MS) return;
      lastMarkedMs.set(sessionId, now);
      await mutate(
        KEY,
        (prev: Record<string, number> | undefined) => ({
          ...(prev ?? {}),
          [sessionId]: ms,
        }),
        { revalidate: false },
      );
      try {
        await fetch(KEY, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, ms }),
        });
      } catch {
        /* network blip - the SWR refreshInterval will reconcile */
      }
    },
    [mutate],
  );
}

export function useMarkManyViewed() {
  const { mutate } = useSWRConfig();
  return useCallback(
    async (sessionIds: string[], ms: number = Date.now()) => {
      if (sessionIds.length === 0) return;
      await mutate(
        KEY,
        (prev: Record<string, number> | undefined) => {
          const next = { ...(prev ?? {}) };
          for (const id of sessionIds) next[id] = ms;
          return next;
        },
        { revalidate: false },
      );
      try {
        await fetch(KEY, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionIds, ms }),
        });
      } catch {
        /* network blip - the SWR refreshInterval will reconcile */
      }
    },
    [mutate],
  );
}
