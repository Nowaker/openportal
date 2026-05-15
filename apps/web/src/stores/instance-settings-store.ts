import useSWR, { mutate as globalMutate } from "swr";

const KEY = "/api/instance-settings";

export interface InstanceSettings {
  toolOutputMaxBytes: number | null;
}

export const EMPTY_INSTANCE_SETTINGS: InstanceSettings = {
  toolOutputMaxBytes: null,
};

async function fetcher(url: string): Promise<InstanceSettings> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`instance-settings fetch failed: ${r.status}`);
  const raw = (await r.json()) as Partial<InstanceSettings>;
  const cap = raw.toolOutputMaxBytes;
  return {
    toolOutputMaxBytes:
      typeof cap === "number" && cap > 0 && Number.isFinite(cap)
        ? Math.floor(cap)
        : null,
  };
}

export function useInstanceSettings(): {
  settings: InstanceSettings;
  isLoading: boolean;
  error: Error | undefined;
} {
  const { data, isLoading, error } = useSWR<InstanceSettings>(KEY, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 2000,
    keepPreviousData: true,
  });
  return {
    settings: data ?? EMPTY_INSTANCE_SETTINGS,
    isLoading: isLoading && !data,
    error: error as Error | undefined,
  };
}

export async function setToolOutputMaxBytes(
  value: number | null,
): Promise<void> {
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolOutputMaxBytes: value }),
  });
  if (!r.ok) throw new Error(`setToolOutputMaxBytes failed: ${r.status}`);
  const next = (await r.json()) as InstanceSettings;
  await globalMutate(KEY, next, { revalidate: false });
}
