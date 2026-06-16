import { useMemo } from "react";
import { useProviders } from "@/hooks/use-opencode";
import { useInstanceStore } from "@/stores/instance-store";
import {
  getOverridesForServer,
  useModelVisibility,
} from "@/stores/model-visibility-store";
import {
  computeLatestSet,
  filterVisibleProviders,
  type RawProvider,
} from "@/lib/model-visibility";

// Returns the same SWR shape as useProviders() but with each provider's
// `models` record filtered down to the visible models for the active
// server. Providers that end up with zero visible models are dropped.
//
// Both the Settings "Default model" picker and the per-session model
// picker call this so the user's hidden-models choice in
// Settings -> Models takes effect across the whole UI.

interface RawProvidersResponse {
  providers?: RawProvider[];
  default?: Record<string, string>;
}

export function useVisibleProviders() {
  const swr = useProviders();
  const { config } = useModelVisibility();
  const instance = useInstanceStore((s) => s.instance);
  const serverId = instance?.id ?? null;

  const filtered = useMemo<RawProvidersResponse | undefined>(() => {
    const raw = swr.data as RawProvidersResponse | undefined;
    if (!raw) return raw;
    const providers = raw.providers ?? [];
    const latestSet = computeLatestSet(providers);
    const overrides = getOverridesForServer(config, serverId);
    const out = filterVisibleProviders(
      providers,
      serverId,
      overrides,
      latestSet,
    );
    return { ...raw, providers: out };
  }, [swr.data, config, serverId]);

  return {
    ...swr,
    data: filtered,
  };
}
