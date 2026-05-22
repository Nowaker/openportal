// Stale-while-revalidate cache for opencode bootstrap data
// (agents, providers, config). Keyed by `${port}:${kind}`.
//
// Semantics:
//   - First call:       awaits the upstream fetch, stores the result.
//   - Subsequent calls within FRESH_MS:
//                       returns cached data immediately, no upstream call.
//   - Subsequent calls between FRESH_MS and STALE_MS:
//                       returns cached data immediately AND fires a
//                       background revalidation. Caller never waits.
//   - Subsequent calls after STALE_MS:
//                       awaits a fresh fetch (treated like first call).
//
// Errors during background revalidation are swallowed - the cached data
// stays, the next refresh will retry. Errors during the awaited fetches
// propagate to the caller.

const FRESH_MS = 5_000;
const STALE_MS = 5 * 60_000;

interface Entry<T> {
  data: T;
  fetchedAt: number;
  refreshing: Promise<T> | null;
}

const store = new Map<string, Entry<unknown>>();

export async function bootstrapCacheGet<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const entry = store.get(key) as Entry<T> | undefined;

  if (!entry || now - entry.fetchedAt > STALE_MS) {
    const data = await fetcher();
    store.set(key, { data, fetchedAt: Date.now(), refreshing: null });
    return data;
  }

  if (now - entry.fetchedAt > FRESH_MS && !entry.refreshing) {
    entry.refreshing = (async () => {
      try {
        const fresh = await fetcher();
        store.set(key, {
          data: fresh,
          fetchedAt: Date.now(),
          refreshing: null,
        });
        return fresh;
      } catch {
        if (entry) entry.refreshing = null;
        return entry.data;
      }
    })();
  }

  return entry.data;
}

export function bootstrapCacheInvalidate(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
