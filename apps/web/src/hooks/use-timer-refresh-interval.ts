import useMediaQuery from "./use-media-query";
import {
  DEFAULT_TIMER_REFRESH_DESKTOP_SEC,
  DEFAULT_TIMER_REFRESH_MOBILE_SEC,
  useUpdateStrategyStore,
} from "@/stores/update-strategy-store";

export function useTimerRefreshIntervalMs(): number {
  const { isMobile } = useMediaQuery();
  const desktopSec = useUpdateStrategyStore((s) => s.timerRefreshDesktopSec);
  const mobileSec = useUpdateStrategyStore((s) => s.timerRefreshMobileSec);
  const seconds = isMobile
    ? mobileSec ?? DEFAULT_TIMER_REFRESH_MOBILE_SEC
    : desktopSec ?? DEFAULT_TIMER_REFRESH_DESKTOP_SEC;
  return Math.max(1000, Math.round(seconds * 1000));
}
