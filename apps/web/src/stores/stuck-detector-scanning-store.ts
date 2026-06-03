import useSWR, { mutate as globalMutate } from "swr";

// Client store for the stuck-detector plugin's runtime scanning toggle.
// The plugin (opencode-tools/_lib/stuck-detector) exposes GET/PUT
// /scanning on its loopback HTTP server; portal proxies that through
// /api/stuck-detector/scanning. Persisted state lives in the plugin's
// own state file, so the toggle survives plugin / opencode restarts.

const KEY = "/api/stuck-detector/scanning";

export interface ScanningResponse {
  ok: boolean;
  enabled?: boolean;
  error?: string;
  status?: number;
}

async function fetcher(url: string): Promise<ScanningResponse> {
  const r = await fetch(url);
  return (await r.json()) as ScanningResponse;
}

export function useStuckDetectorScanning() {
  return useSWR<ScanningResponse>(KEY, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5_000,
    keepPreviousData: true,
  });
}

export async function setStuckDetectorScanning(
  enabled: boolean,
): Promise<ScanningResponse> {
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const body = (await r.json()) as ScanningResponse;
  if (body.ok) {
    await globalMutate(KEY, body, { revalidate: false });
  }
  return body;
}
