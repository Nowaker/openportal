import useMediaQuery from "./use-media-query";
import {
  useUpdateStrategyStore,
  type UpdateStrategy,
} from "@/stores/update-strategy-store";

const MOBILE_QUERY = "(max-width: 767px)";

export function useActiveStrategy(): UpdateStrategy {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const desktop = useUpdateStrategyStore((s) => s.desktop);
  const mobile = useUpdateStrategyStore((s) => s.mobile);
  return isMobile ? mobile : desktop;
}

export function strategyAllowsEventStream(strategy: UpdateStrategy): boolean {
  return strategy !== "polling";
}

export function strategyDisablesTimerPoll(strategy: UpdateStrategy): boolean {
  return strategy !== "polling";
}
