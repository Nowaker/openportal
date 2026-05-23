// Caching-proxy cache for opencode bootstrap data (agents, providers,
// config). Keyed by `${port}:${kind}`. Per the user's caching-proxy
// directive: once we've seen the data, we cache it. Only AUTHORITATIVE
// opencode responses update the cache. Timeouts/errors NEVER clear it
// and NEVER propagate up to the caller as long as we have any cached
// entry.
//
// Semantics:
//   - First call (cold, no cache): awaits the upstream fetch,
//     stores the result. On failure, propagates error (no cache to
//     fall back to).
//   - Within FRESH_MS: returns cached, no upstream call.
//   - Between FRESH_MS and STALE_MS: returns cached + kicks off
//     background revalidation. Caller never waits.
//   - Past STALE_MS but cache exists: returns cached + kicks off
//     background revalidation (NOT a blocking refresh - that was the
//     pre-caching-proxy behavior that 502'd the frontend on every
//     poll after opencode hung for 5+ minutes).
//   - Background revalidation failure: cached entry stays, no error
//     propagates. Next caller still gets the stale data.

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

  if (!entry) {
    const data = await fetcher();
    store.set(key, { data, fetchedAt: Date.now(), refreshing: null });
    return data;
  }

  // Any cached entry triggers background refresh (no blocking await,
  // never propagates errors). The pre-caching-proxy version would
  // synchronously refetch past STALE_MS and 502 the frontend when
  // opencode hung; the user's invariant ('openportal must be a
  // caching proxy... if it takes forever, so be it') means we always
  // serve cache and reconcile in the background.
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
