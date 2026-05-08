import useSWR from "swr";
import { useInstanceStore } from "@/stores/instance-store";

export type PluginSource = "local" | "npm";

export interface PluginInfo {
  spec: string;
  source: PluginSource;
  resolvedTarget: string;
  packageRoot?: string;
  id?: string;
  name: string;
  requestedVersion?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  repositoryUrl?: string;
  homepage?: string;
  entryPoint?: string;
  pluginKind: "server" | "tui" | "theme-only" | "unknown";
  exportedFunctions: string[];
  readme?: string;
  diagnostics: string[];
}

export interface PluginInfoResponse {
  info: PluginInfo | null;
  refreshing: boolean;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

export function usePluginInfo(spec: string | null) {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const swr = useSWR<PluginInfoResponse>(
    port && spec
      ? `/api/opencode/${port}/plugin-info?spec=${encodeURIComponent(spec)}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      refreshInterval: (data) => (data && data.info === null ? 1500 : 0),
    },
  );
  return swr;
}

export async function refreshPluginInfoServerSide(
  port: number | null,
  spec: string,
): Promise<void> {
  if (!port) return;
  await fetch(`/api/opencode/${port}/plugin-info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spec }),
  });
}
