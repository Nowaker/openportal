import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UpdateStrategy = "polling" | "snapshot" | "chunked" | "asap";

export interface PlatformStrategies {
  desktop: UpdateStrategy;
  mobile: UpdateStrategy;
}

interface StrategyState extends PlatformStrategies {
  pollingIntervalSec: number | undefined;
  setDesktop: (s: UpdateStrategy) => void;
  setMobile: (s: UpdateStrategy) => void;
  setPollingIntervalSec: (n: number | undefined) => void;
}

export const DEFAULT_POLLING_INTERVAL_SEC = 3;

// Per-platform defaults: desktop favors latency over battery; mobile
// favors battery over latency. Both can be overridden in Settings.
// "chunked" is the middle-of-the-road default for mobile: SSE-driven
// but throttles delta events to 250ms windows so even a 200-token/s
// model doesn't redraw the prose 200 times per second.
const DEFAULTS: PlatformStrategies = {
  desktop: "asap",
  mobile: "chunked",
};

export const useUpdateStrategyStore = create<StrategyState>()(
  persist(
    (set) => ({
      desktop: DEFAULTS.desktop,
      mobile: DEFAULTS.mobile,
      pollingIntervalSec: undefined,
      setDesktop: (s) => set({ desktop: s }),
      setMobile: (s) => set({ mobile: s }),
      setPollingIntervalSec: (n) => set({ pollingIntervalSec: n }),
    }),
    {
      name: "openportal-update-strategy",
      version: 2,
      migrate: (persisted: unknown, fromVersion) => {
        // v0 -> v1 migration. The previous store ("opencode-streaming-mode")
        // was a single boolean `enabled` toggle. New users get the per-
        // platform defaults; users with a previous setting are migrated:
        //   old enabled=true  -> snapshot on both (best preservation of
        //                        their event-driven-invalidation intent)
        //   old enabled=false -> polling on both
        if (fromVersion === 0 && persisted && typeof persisted === "object") {
          const o = persisted as { enabled?: boolean };
          if (typeof o.enabled === "boolean") {
            const s: UpdateStrategy = o.enabled ? "snapshot" : "polling";
            return {
              desktop: s,
              mobile: s,
              pollingIntervalSec: undefined,
              setDesktop: () => {},
              setMobile: () => {},
              setPollingIntervalSec: () => {},
            };
          }
        }
        // v1 -> v2: add pollingIntervalSec field, undefined means use default.
        if (fromVersion === 1 && persisted && typeof persisted === "object") {
          return {
            ...(persisted as object),
            pollingIntervalSec: undefined,
          } as StrategyState;
        }
        return persisted as StrategyState;
      },
    },
  ),
);
