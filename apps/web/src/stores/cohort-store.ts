import useSWR from "swr";

const KEY = "/api/cohort";

export interface CohortWorker {
  workerID: string;
  instanceUrl: string;
  host: string;
  port: number;
  lastSeen: number;
  ownBusyCount: number;
}

export interface CohortSnapshot {
  workers: CohortWorker[];
  fetchedAt: number;
  pluginReachable: boolean;
}

const EMPTY: CohortSnapshot = {
  workers: [],
  fetchedAt: 0,
  pluginReachable: false,
};

async function fetcher(url: string): Promise<CohortSnapshot> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`cohort fetch failed: ${r.status}`);
  return (await r.json()) as CohortSnapshot;
}

export function useCohort(refreshMs = 30_000): {
  cohort: CohortSnapshot;
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<CohortSnapshot>(KEY, fetcher, {
    refreshInterval: refreshMs,
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: 10_000,
  });
  return {
    cohort: data ?? EMPTY,
    isLoading: isLoading && !data,
  };
}
