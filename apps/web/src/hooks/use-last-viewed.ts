import useSWR, { useSWRConfig } from "swr";
import { usePollMs } from "@/hooks/use-opencode";

const KEY = "/api/state/last-viewed";

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
  return async (sessionId: string, ms: number = Date.now()) => {
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
  };
}

export function useMarkManyViewed() {
  const { mutate } = useSWRConfig();
  return async (sessionIds: string[], ms: number = Date.now()) => {
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
  };
}
