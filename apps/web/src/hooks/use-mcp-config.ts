import useSWR, { useSWRConfig } from "swr";

export interface McpConfigEntry {
  type?: "local" | "remote" | string;
  enabled?: boolean;
  url?: string;
  command?: string[];
  headers?: Record<string, string>;
  environment?: Record<string, string>;
  env?: Record<string, string>;
  [k: string]: unknown;
}

export type McpConfigMap = Record<string, McpConfigEntry>;

export interface McpConfigResponse {
  configPath: string;
  pending: boolean;
  current: McpConfigMap;
  active: McpConfigMap;
  capturedAt: string;
  diff: {
    added: string[];
    removed: string[];
    modified: string[];
  };
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

const KEY = "/api/mcp-config";

export function useMcpConfig() {
  return useSWR<McpConfigResponse>(KEY, fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
}

export function useUpdateMcpEntry() {
  const { mutate } = useSWRConfig();
  return async (name: string, entry: McpConfigEntry | null): Promise<McpConfigResponse> => {
    const res = await fetch(`${KEY}/entry`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, entry }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Failed to save MCP: ${res.status} ${txt}`);
    }
    const json = (await res.json()) as McpConfigResponse & { ok: boolean };
    await mutate(KEY, json, { revalidate: false });
    return json;
  };
}

export function useMarkMcpRestarted() {
  const { mutate } = useSWRConfig();
  return async () => {
    await fetch(`${KEY}/mark-restarted`, { method: "POST" });
    await mutate(KEY);
  };
}
