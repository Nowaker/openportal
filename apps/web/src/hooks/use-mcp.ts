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

// Two-layer toggle:
//
//   1. PUT /api/mcp-config/entry to flip `enabled` in opencode.json so the
//      change PERSISTS across opencode restarts. This is the source of
//      truth; without it, a runtime-only disconnect on opencode 1.15.6
//      either fails silently or gets reverted on the next reconcile cycle
//      because the config still says enabled:true (#103).
//   2. Best-effort POST to opencode's runtime /mcp toggle. If opencode
//      honors it the slider flips immediately; if it silently no-ops the
//      file-level change still ensures the next opencode restart picks up
//      the right state (PENDING RESTART badge fires from #102 + V1).
export function useToggleMcp() {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const { mutate } = useSWRConfig();
  return async (name: string, action: "connect" | "disconnect") => {
    const enabled = action === "connect";
    // Step 1: flip enabled in opencode.json. Need the current entry to
    // do a merge-PUT; read the latest /api/mcp-config cache freshly.
    try {
      const cfgRes = await fetch("/api/mcp-config");
      if (cfgRes.ok) {
        const cfg = (await cfgRes.json()) as {
          current?: Record<string, Record<string, unknown>>;
        };
        const currentEntry = cfg.current?.[name];
        if (currentEntry) {
          await fetch("/api/mcp-config/entry", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              entry: { ...currentEntry, enabled },
            }),
          });
          await mutate("/api/mcp-config");
        }
      }
    } catch {
      /* fall through to runtime toggle */
    }
    // Step 2: runtime toggle for immediate slider feedback.
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
