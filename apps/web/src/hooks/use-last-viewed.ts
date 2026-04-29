import useSWR, { useSWRConfig } from "swr";

const KEY = "/api/state/last-viewed";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

export function useLastViewed() {
  return useSWR<Record<string, number>>(KEY, fetcher, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: 5000,
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
