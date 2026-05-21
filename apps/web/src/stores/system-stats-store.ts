import useSWR from "swr";

const KEY = "/api/system-stats";

export interface OpencodeProcess {
  pid: number;
  rssKb: number;
  cpuPercent: number;
  cmdline: string;
}

export interface SystemStats {
  load: { one: number; five: number; fifteen: number } | null;
  memory: {
    totalKb: number;
    availableKb: number;
    usedKb: number;
    usedPercent: number;
  } | null;
  opencodeProcesses: OpencodeProcess[];
  observedAt: number;
}

const EMPTY: SystemStats = {
  load: null,
  memory: null,
  opencodeProcesses: [],
  observedAt: 0,
};

async function fetcher(url: string): Promise<SystemStats> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`system-stats fetch failed: ${r.status}`);
  return (await r.json()) as SystemStats;
}

export function useSystemStats(refreshMs = 10_000): {
  stats: SystemStats;
  isLoading: boolean;
  error: Error | undefined;
} {
  const { data, isLoading, error } = useSWR<SystemStats>(KEY, fetcher, {
    refreshInterval: refreshMs,
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: 3000,
  });
  return {
    stats: data ?? EMPTY,
    isLoading: isLoading && !data,
    error: error as Error | undefined,
  };
}
