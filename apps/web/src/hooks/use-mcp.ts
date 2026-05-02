import useSWR, { useSWRConfig } from "swr";
import { useInstanceStore } from "@/stores/instance-store";

export type McpStatusKind =
  | "connected"
  | "disabled"
  | "failed"
  | "needsAuth"
  | "needsClientRegistration";

export interface McpStatus {
  status: McpStatusKind;
  error?: unknown;
}

export type McpStatusMap = Record<string, McpStatus>;

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

function buildKey(port: number | null) {
  return port ? `/api/opencode/${port}/mcp` : null;
}

export function useMcpStatus() {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  return useSWR<McpStatusMap>(buildKey(port), fetcher, {
    revalidateOnFocus: true,
  });
}

export function useToggleMcp() {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const { mutate } = useSWRConfig();
  return async (name: string, action: "connect" | "disconnect") => {
    if (!port) return;
    const key = buildKey(port);
    if (!key) return;
    try {
      const res = await fetch(key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, action }),
      });
      if (res.ok) {
        const json = (await res.json()) as McpStatusMap;
        await mutate(key, json, { revalidate: false });
      }
    } catch {
      /* network blip - SWR will retry on next focus */
    }
  };
}
