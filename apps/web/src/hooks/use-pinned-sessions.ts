import useSWR, { useSWRConfig } from "swr";

const KEY = "/api/state/pinned";

interface PinnedResponse {
  sessions: string[];
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as PinnedResponse;
};

export function usePinnedSessions() {
  return useSWR<PinnedResponse>(KEY, fetcher, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: 5000,
    keepPreviousData: true,
  });
}

export function useTogglePinnedSession() {
  const { mutate } = useSWRConfig();
  return async (sessionId: string, action: "pin" | "unpin") => {
    await mutate(
      KEY,
      (prev: PinnedResponse | undefined) => {
        const list = prev?.sessions ?? [];
        if (action === "pin") {
          return { sessions: [...list.filter((s) => s !== sessionId), sessionId] };
        }
        return { sessions: list.filter((s) => s !== sessionId) };
      },
      { revalidate: false },
    );
    try {
      const res = await fetch(KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, action }),
      });
      if (res.ok) {
        const json = (await res.json()) as PinnedResponse;
        await mutate(KEY, json, { revalidate: false });
      }
    } catch {
      /* network blip - SWR refreshInterval will reconcile */
    }
  };
}

export function useReorderPinnedSessions() {
  const { mutate } = useSWRConfig();
  return async (order: string[]) => {
    await mutate(KEY, { sessions: order }, { revalidate: false });
    try {
      const res = await fetch(KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder", order }),
      });
      if (res.ok) {
        const json = (await res.json()) as PinnedResponse;
        await mutate(KEY, json, { revalidate: false });
      }
    } catch {
      /* network blip - SWR refreshInterval will reconcile */
    }
  };
}
