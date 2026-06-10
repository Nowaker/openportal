import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UpdateStrategy = "polling" | "snapshot" | "chunked" | "asap";

export interface PlatformStrategies {
  desktop: UpdateStrategy;
  mobile: UpdateStrategy;
}

interface StrategyState extends PlatformStrategies {
  pollingIntervalSec: number | undefined;
  timerRefreshDesktopSec: number | undefined;
  timerRefreshMobileSec: number | undefined;
  setDesktop: (s: UpdateStrategy) => void;
  setMobile: (s: UpdateStrategy) => void;
  setPollingIntervalSec: (n: number | undefined) => void;
  setTimerRefreshDesktopSec: (n: number | undefined) => void;
  setTimerRefreshMobileSec: (n: number | undefined) => void;
}

export const DEFAULT_POLLING_INTERVAL_SEC = 3;
export const DEFAULT_TIMER_REFRESH_DESKTOP_SEC = 1;
export const DEFAULT_TIMER_REFRESH_MOBILE_SEC = 5;

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
      timerRefreshDesktopSec: undefined,
      timerRefreshMobileSec: undefined,
      setDesktop: (s) => set({ desktop: s }),
      setMobile: (s) => set({ mobile: s }),
      setPollingIntervalSec: (n) => set({ pollingIntervalSec: n }),
      setTimerRefreshDesktopSec: (n) => set({ timerRefreshDesktopSec: n }),
      setTimerRefreshMobileSec: (n) => set({ timerRefreshMobileSec: n }),
    }),
    {
      name: "openportal-update-strategy",
      version: 3,
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
              timerRefreshDesktopSec: undefined,
              timerRefreshMobileSec: undefined,
              setDesktop: () => {},
              setMobile: () => {},
              setPollingIntervalSec: () => {},
              setTimerRefreshDesktopSec: () => {},
              setTimerRefreshMobileSec: () => {},
            };
          }
        }
        // v1 -> v2: add pollingIntervalSec field, undefined means use default.
        if (fromVersion === 1 && persisted && typeof persisted === "object") {
          return {
            ...(persisted as object),
            pollingIntervalSec: undefined,
            timerRefreshDesktopSec: undefined,
            timerRefreshMobileSec: undefined,
          } as StrategyState;
        }
        // v2 -> v3: add Thinking timer refresh cadence fields.
        if (fromVersion === 2 && persisted && typeof persisted === "object") {
          return {
            ...(persisted as object),
            timerRefreshDesktopSec: undefined,
            timerRefreshMobileSec: undefined,
          } as StrategyState;
        }
        return persisted as StrategyState;
      },
    },
  ),
);
