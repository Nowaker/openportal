import useSWR from "swr";

// Stuck-detector verdict for a single session. Mirrors the plugin's
// /verdicts/<sid> response shape (opencode-tools 65fbbf2 + 22736c4).
// owner_instance_url is the canonical signal for 'which opencode
// instance is currently dispatching this session' - the only field in
// the system that knows this across multi-instance cohorts.
export interface SessionVerdict {
  workerID?: string;
  sessionID?: string;
  owner_instance_url?: string | null;
  verdict?: "idle" | "in-progress" | "stuck" | string;
  cause?: string | null;
  warnings?: string[];
  busy?: boolean;
  last_event_at?: number;
  [key: string]: unknown;
}

interface FetchResult {
  data: SessionVerdict | null;
  status: number;
}

async function fetcher(url: string): Promise<FetchResult> {
  const r = await fetch(url);
  if (r.status === 404) return { data: null, status: 404 };
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    const msg =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  const body = (await r.json()) as SessionVerdict;
  return { data: body, status: r.status };
}

export function useSessionVerdict(
  sessionId: string | null | undefined,
  refreshMs = 15_000,
): {
  verdict: SessionVerdict | null;
  isLoading: boolean;
  notFound: boolean;
  error: Error | null;
} {
  const key = sessionId
    ? `/api/stuck-detector/verdict/${encodeURIComponent(sessionId)}`
    : null;
  const { data, isLoading, error } = useSWR<FetchResult, Error>(key, fetcher, {
    refreshInterval: refreshMs,
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: 5_000,
  });
  return {
    verdict: data?.data ?? null,
    isLoading: isLoading && !data,
    notFound: data?.status === 404,
    error: error ?? null,
  };
}
