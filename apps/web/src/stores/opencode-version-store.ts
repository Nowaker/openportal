import useSWR, { mutate as globalMutate } from "swr";

const KEY = "/api/opencode-version";

export interface OpencodeVersionInfo {
  installed: string | null;
  lastAcknowledgedVersion: string | null;
  updated: boolean;
}

const EMPTY: OpencodeVersionInfo = {
  installed: null,
  lastAcknowledgedVersion: null,
  updated: false,
};

async function fetcher(url: string): Promise<OpencodeVersionInfo> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`opencode-version fetch failed: ${r.status}`);
  const raw = (await r.json()) as Partial<OpencodeVersionInfo>;
  return {
    installed: typeof raw.installed === "string" ? raw.installed : null,
    lastAcknowledgedVersion:
      typeof raw.lastAcknowledgedVersion === "string"
        ? raw.lastAcknowledgedVersion
        : null,
    updated: raw.updated === true,
  };
}

export function useOpencodeVersion(): {
  info: OpencodeVersionInfo;
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<OpencodeVersionInfo>(KEY, fetcher, {
    refreshInterval: 60 * 60 * 1000,
    revalidateOnFocus: false,
    dedupingInterval: 60 * 1000,
    keepPreviousData: true,
  });
  return { info: data ?? EMPTY, isLoading: isLoading && !data };
}

export async function acknowledgeOpencodeVersion(): Promise<void> {
  const r = await fetch(KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error(`acknowledge failed: ${r.status}`);
  const next = (await r.json()) as OpencodeVersionInfo;
  await globalMutate(KEY, next, false);
}
