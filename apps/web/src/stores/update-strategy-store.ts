import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UpdateStrategy = "polling" | "snapshot" | "chunked" | "asap";

export interface PlatformStrategies {
  desktop: UpdateStrategy;
  mobile: UpdateStrategy;
}

interface StrategyState extends PlatformStrategies {
  setDesktop: (s: UpdateStrategy) => void;
  setMobile: (s: UpdateStrategy) => void;
}

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
      setDesktop: (s) => set({ desktop: s }),
      setMobile: (s) => set({ mobile: s }),
    }),
    {
      name: "openportal-update-strategy",
      version: 1,
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
              setDesktop: () => {},
              setMobile: () => {},
            };
          }
        }
        return persisted as StrategyState;
      },
    },
  ),
);
