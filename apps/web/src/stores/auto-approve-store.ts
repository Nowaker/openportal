// Auto-approve client-side state. Backed by the server's persistence
// (~/.openportal-state.json `settings.autoApprove`) via SWR; the browser
// is just a view onto the server-truth config. Replacing the previous
// localStorage-only implementation that broke whenever the browser was
// closed (since auto-approves were fired from the chat-page polling
// loop, not the server).
//
// Effective resolution: per-session override wins over globalDefault.
// Toggling in the composer collapses to "remove override" whenever
// the new value would match globalDefault, so the Settings overrides
// list only shows truly-overridden sessions.

import useSWR, { mutate as globalMutate } from "swr";
import { logSystemMessage } from "@/stores/system-messages-store";

const KEY = "/api/auto-approve";

export interface AutoApproveConfig {
  globalDefault: boolean;
  sessionOverrides: Record<string, boolean>;
}

export const EMPTY_AUTO_APPROVE_CONFIG: AutoApproveConfig = {
  globalDefault: false,
  sessionOverrides: {},
};

async function fetcher(url: string): Promise<AutoApproveConfig> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`auto-approve fetch failed: ${r.status}`);
  const raw = (await r.json()) as Partial<AutoApproveConfig>;
  return {
    globalDefault: Boolean(raw.globalDefault),
    sessionOverrides:
      raw.sessionOverrides && typeof raw.sessionOverrides === "object"
        ? raw.sessionOverrides
        : {},
  };
}

export function useAutoApproveConfig(): {
  config: AutoApproveConfig;
  isLoading: boolean;
  error: Error | undefined;
} {
  const { data, isLoading, error } = useSWR<AutoApproveConfig>(KEY, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 2000,
    keepPreviousData: true,
  });
  return {
    config: data ?? EMPTY_AUTO_APPROVE_CONFIG,
    isLoading: isLoading && !data,
    error: error as Error | undefined,
  };
}

export function isEffectivelyEnabled(
  config: AutoApproveConfig,
  sessionId: string | null,
): boolean {
  if (!sessionId) return false;
  if (sessionId in config.sessionOverrides) {
    return config.sessionOverrides[sessionId];
  }
  return config.globalDefault;
}

export function hasSessionOverride(
  config: AutoApproveConfig,
  sessionId: string | null,
): boolean {
  if (!sessionId) return false;
  return sessionId in config.sessionOverrides;
}

async function pushConfig(next: AutoApproveConfig): Promise<void> {
  await globalMutate(KEY, next, { revalidate: false });
}

export async function setAutoApproveDefault(value: boolean): Promise<void> {
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!r.ok) throw new Error(`setAutoApproveDefault failed: ${r.status}`);
  const next = (await r.json()) as AutoApproveConfig;
  await pushConfig(next);
  logSystemMessage(
    "other",
    "info",
    `Auto-approve global default set to ${value ? "ON" : "OFF"}`,
  );
}

export async function setSessionOverride(
  sessionId: string,
  value: boolean,
): Promise<void> {
  const r = await fetch(
    `${KEY}/session/${encodeURIComponent(sessionId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    },
  );
  if (!r.ok) throw new Error(`setSessionOverride failed: ${r.status}`);
  const next = (await r.json()) as AutoApproveConfig;
  await pushConfig(next);
  logSystemMessage(
    "other",
    "info",
    `Auto-approve override for ${sessionId.slice(0, 12)}\u2026 set to ${value ? "ON" : "OFF"}`,
  );
}

export async function removeSessionOverride(
  sessionId: string,
): Promise<void> {
  const r = await fetch(
    `${KEY}/session/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  if (!r.ok) throw new Error(`removeSessionOverride failed: ${r.status}`);
  const next = (await r.json()) as AutoApproveConfig;
  await pushConfig(next);
  logSystemMessage(
    "other",
    "info",
    `Auto-approve override removed for ${sessionId.slice(0, 12)}\u2026`,
  );
}

export async function clearAllOverrides(): Promise<void> {
  const r = await fetch(`${KEY}/sessions`, { method: "DELETE" });
  if (!r.ok) throw new Error(`clearAllOverrides failed: ${r.status}`);
  const next = (await r.json()) as AutoApproveConfig;
  await pushConfig(next);
  logSystemMessage(
    "other",
    "info",
    "All auto-approve session overrides cleared",
  );
}

export async function toggleAutoApprove(
  sessionId: string,
  config: AutoApproveConfig,
): Promise<void> {
  const effective = isEffectivelyEnabled(config, sessionId);
  const next = !effective;
  if (next === config.globalDefault) {
    if (sessionId in config.sessionOverrides) {
      await removeSessionOverride(sessionId);
    }
  } else {
    await setSessionOverride(sessionId, next);
  }
}
