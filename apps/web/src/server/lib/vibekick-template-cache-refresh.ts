const PERIODIC_REFRESH_MS = 5 * 60 * 1000;

export function startTemplateCacheRefreshLoop(
  refresh: () => Promise<void>,
): void {
  if (typeof setInterval !== "function") return;
  setInterval(() => {
    void refresh().catch((error: unknown) => {
      console.warn(
        "[vibekick-templates] periodic scan failed; preserving completed snapshot",
        error instanceof Error ? error.message : error,
      );
    });
  }, PERIODIC_REFRESH_MS);
}
