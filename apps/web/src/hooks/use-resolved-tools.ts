import { useMemo } from "react";
import {
  resolveToolsFromState,
  type ResolvedTool,
  useToolsStore,
} from "@/stores/tools-store";

export function useResolvedTools(): ResolvedTool[] {
  const disabledIds = useToolsStore((s) => s.disabledIds);
  const burgerHiddenIds = useToolsStore((s) => s.burgerHiddenIds);
  const outsideBurgerIds = useToolsStore((s) => s.outsideBurgerIds);
  const iconOverrides = useToolsStore((s) => s.iconOverrides);
  const systemOverrides = useToolsStore((s) => s.systemOverrides);
  const customTools = useToolsStore((s) => s.customTools);
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const defaultOnInitIds = useToolsStore((s) => s.defaultOnInitIds);
  const slashCommandIds = useToolsStore((s) => s.slashCommandIds);
  return useMemo(
    () =>
      resolveToolsFromState({
        disabledIds,
        burgerHiddenIds,
        outsideBurgerIds,
        iconOverrides,
        systemOverrides,
        customTools,
        projectInitOrder,
        defaultOnInitIds,
        slashCommandIds,
      }),
    [
      disabledIds,
      burgerHiddenIds,
      outsideBurgerIds,
      iconOverrides,
      systemOverrides,
      customTools,
      projectInitOrder,
      defaultOnInitIds,
      slashCommandIds,
    ],
  );
}
