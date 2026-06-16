import useSWR, { mutate as globalMutate } from "swr";

const KEY = "/api/model-visibility";

export type Visibility = "show" | "hide";

export interface ModelVisibilityConfig {
  byServer: Record<string, Record<string, Visibility>>;
}

export const EMPTY_VISIBILITY: ModelVisibilityConfig = { byServer: {} };

function coerce(raw: unknown): ModelVisibilityConfig {
  if (!raw || typeof raw !== "object") return EMPTY_VISIBILITY;
  const obj = raw as Partial<ModelVisibilityConfig>;
  if (!obj.byServer || typeof obj.byServer !== "object") return EMPTY_VISIBILITY;
  const out: ModelVisibilityConfig = { byServer: {} };
  for (const [serverId, models] of Object.entries(obj.byServer)) {
    if (!models || typeof models !== "object") continue;
    const cleaned: Record<string, Visibility> = {};
    for (const [k, v] of Object.entries(models as Record<string, unknown>)) {
      if (v === "show" || v === "hide") cleaned[k] = v;
    }
    out.byServer[serverId] = cleaned;
  }
  return out;
}

async function fetcher(url: string): Promise<ModelVisibilityConfig> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`model-visibility fetch failed: ${r.status}`);
  return coerce(await r.json());
}

export function useModelVisibility(): {
  config: ModelVisibilityConfig;
  isLoading: boolean;
  error: Error | undefined;
} {
  const { data, isLoading, error } = useSWR<ModelVisibilityConfig>(
    KEY,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 2000,
      keepPreviousData: true,
    },
  );
  return {
    config: data ?? EMPTY_VISIBILITY,
    isLoading: isLoading && !data,
    error: error as Error | undefined,
  };
}

export function getOverride(
  config: ModelVisibilityConfig,
  serverId: string | null,
  modelKey: string,
): Visibility | undefined {
  if (!serverId) return undefined;
  return config.byServer[serverId]?.[modelKey];
}

export function getOverridesForServer(
  config: ModelVisibilityConfig,
  serverId: string | null,
): Record<string, Visibility> {
  if (!serverId) return {};
  return config.byServer[serverId] ?? {};
}

// Optimistic write-through: patch SWR cache before the network round-trip
// so the toggle in the UI flips instantly. On error we refetch (revalidate)
// to drop the optimistic value and reflect what the server actually has.
export async function setVisibility(
  serverId: string,
  modelKey: string,
  visibility: Visibility,
): Promise<void> {
  await globalMutate<ModelVisibilityConfig>(
    KEY,
    (current) => {
      const base = current ?? EMPTY_VISIBILITY;
      return {
        byServer: {
          ...base.byServer,
          [serverId]: {
            ...(base.byServer[serverId] ?? {}),
            [modelKey]: visibility,
          },
        },
      };
    },
    { revalidate: false },
  );
  try {
    const r = await fetch(KEY, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, modelKey, visibility }),
    });
    if (!r.ok) throw new Error(`setVisibility failed: ${r.status}`);
    const next = coerce(await r.json());
    await globalMutate(KEY, next, { revalidate: false });
  } catch (e) {
    await globalMutate(KEY);
    throw e;
  }
}

export async function clearVisibility(
  serverId: string,
  modelKey: string,
): Promise<void> {
  await globalMutate<ModelVisibilityConfig>(
    KEY,
    (current) => {
      const base = current ?? EMPTY_VISIBILITY;
      const perServer = { ...(base.byServer[serverId] ?? {}) };
      delete perServer[modelKey];
      const next = { ...base.byServer };
      if (Object.keys(perServer).length > 0) {
        next[serverId] = perServer;
      } else {
        delete next[serverId];
      }
      return { byServer: next };
    },
    { revalidate: false },
  );
  try {
    const r = await fetch(KEY, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, modelKey, clear: true }),
    });
    if (!r.ok) throw new Error(`clearVisibility failed: ${r.status}`);
    const next = coerce(await r.json());
    await globalMutate(KEY, next, { revalidate: false });
  } catch (e) {
    await globalMutate(KEY);
    throw e;
  }
}

export async function clearServerVisibility(
  serverId: string,
): Promise<void> {
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, clearServer: true }),
  });
  if (!r.ok) throw new Error(`clearServerVisibility failed: ${r.status}`);
  const next = coerce(await r.json());
  await globalMutate(KEY, next, { revalidate: false });
}
