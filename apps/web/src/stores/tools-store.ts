import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SYSTEM_TOOLS, type SystemTool } from "@/lib/prompt-tools";

export interface CustomTool {
  id: string;
  name: string;
  description?: string;
  prompt: string;
}

export type ResolvedTool =
  | (SystemTool & {
      kind: "system";
      isInBurger: boolean;
      isDisabled: boolean;
      enabled: boolean;
      isOverridden: boolean;
      isInit: boolean;
      isSlash: boolean;
    })
  | (CustomTool & {
      kind: "custom";
      isInBurger: boolean;
      isDisabled: boolean;
      enabled: boolean;
      isInit: boolean;
      isSlash: boolean;
    });

interface ToolsPersistedState {
  // Templates the user has clicked "Disable" on (in Settings). Fully off:
  // hidden from the topbar burger menu, the new-session picker, and the
  // slash autocomplete. Visualised in Settings as opacity-50 with the
  // three flag checkboxes greyed out. Click "Enable" to restore.
  //
  // localStorage key stays "disabledIds" - matches the pre-split meaning
  // where unchecking the single "On" checkbox effectively fully-disabled
  // the template. Existing user entries continue to mean "I don't want
  // this anywhere", which is exactly what the new "Disabled" state
  // means. No migration needed.
  disabledIds: string[];

  // Templates the user has unchecked from the "Burger" flag (the
  // per-row first checkbox). Controls topbar burger menu visibility ONLY.
  // Templates here STILL appear in the new-session picker and slash
  // autocomplete; Burger-off is NOT a kill switch. New slice introduced
  // when the spec split "On" into "Burger" + "Disable".
  burgerHiddenIds: string[];

  // Per-tool prompt overrides. Stored as full text rather than a diff
  // so the system text can change underneath without merge surprises.
  // Drop the override (resetSystemOverride) to fall back to the system
  // text.
  systemOverrides: Record<string, { name?: string; prompt?: string }>;

  customTools: CustomTool[];

  // Tool ids designated as "Init" templates with explicit ordering.
  // On new-session create, the picker pre-checks these and concatenates
  // their bodies (in this order) as the first submitted prompt. Stored
  // as ORDERED array so drag-drop reordering in Settings is the source
  // of truth for concatenation order. Note: non-init non-disabled
  // templates ALSO appear in the new-session picker (unchecked); the
  // init flag just controls the default-checked state.
  projectInitOrder: string[];

  // Tool ids designated as slash commands. When the user types
  // "/template <q>" in any composer, these tools appear in the slash
  // autocomplete popover under "/template <Full name>". Selecting one
  // replaces the typed token with the body padded to a clean
  // \n\n…\n\n boundary. Set semantics (membership matters, order does
  // not). Filtered by !isDisabled - the Burger flag does NOT affect
  // slash-command visibility.
  slashCommandIds: string[];
}

interface ToolsState extends ToolsPersistedState {
  setBurgerVisible: (id: string, visible: boolean) => void;
  setFullyDisabled: (id: string, disabled: boolean) => void;
  setSystemOverride: (
    id: string,
    override: { name?: string; prompt?: string },
  ) => void;
  resetSystemOverride: (id: string) => void;
  upsertCustomTool: (tool: CustomTool) => void;
  removeCustomTool: (id: string) => void;
  toggleProjectInit: (id: string, enabled: boolean) => void;
  reorderProjectInit: (order: string[]) => void;
  toggleSlashCommand: (id: string, enabled: boolean) => void;
}

// Pure derivation: given the persisted slices, return the resolved tool
// list. Components subscribe to the raw slices and call this through a
// useMemo - putting the spread/map inside a Zustand selector returns a
// fresh array identity on every render and triggers React's infinite
// update loop guard (error #185).
export function resolveToolsFromState(
  state: Pick<
    ToolsPersistedState,
    | "disabledIds"
    | "burgerHiddenIds"
    | "systemOverrides"
    | "customTools"
    | "projectInitOrder"
    | "slashCommandIds"
  >,
): ResolvedTool[] {
  const fullyDisabled = new Set(state.disabledIds);
  const burgerHidden = new Set(state.burgerHiddenIds);
  const initSet = new Set(state.projectInitOrder);
  const slashSet = new Set(state.slashCommandIds);
  const resolveFlags = (id: string) => {
    const isInBurger = !burgerHidden.has(id);
    const isDisabled = fullyDisabled.has(id);
    return {
      isInBurger,
      isDisabled,
      // Backward-compat alias for callers that only care about the
      // "is this template active on the surface that asks?" question.
      // For the topbar burger menu this maps correctly; for the
      // new-session picker / slash popover those callers should use
      // !isDisabled directly.
      enabled: isInBurger && !isDisabled,
      isInit: initSet.has(id),
      isSlash: slashSet.has(id),
    };
  };
  const systemResolved: ResolvedTool[] = SYSTEM_TOOLS.map((tool) => {
    const override = state.systemOverrides[tool.id] ?? {};
    return {
      ...tool,
      name: override.name ?? tool.name,
      prompt: override.prompt ?? tool.prompt,
      kind: "system" as const,
      ...resolveFlags(tool.id),
      isOverridden:
        override.name !== undefined || override.prompt !== undefined,
    };
  });
  const customResolved: ResolvedTool[] = state.customTools.map((tool) => ({
    ...tool,
    kind: "custom" as const,
    ...resolveFlags(tool.id),
  }));
  return [...systemResolved, ...customResolved];
}

function customIdExists(state: ToolsState, id: string): boolean {
  return (
    SYSTEM_TOOLS.some((t) => t.id === id) ||
    state.customTools.some((t) => t.id === id)
  );
}

export const useToolsStore = create<ToolsState>()(
  persist(
    (set) => ({
      disabledIds: [],
      burgerHiddenIds: [],
      systemOverrides: {},
      customTools: [],
      projectInitOrder: [],
      slashCommandIds: [],

      setBurgerVisible: (id, visible) =>
        set((state) => {
          const hidden = new Set(state.burgerHiddenIds);
          if (visible) hidden.delete(id);
          else hidden.add(id);
          return { burgerHiddenIds: Array.from(hidden) };
        }),

      setFullyDisabled: (id, disabled) =>
        set((state) => {
          const off = new Set(state.disabledIds);
          if (disabled) off.add(id);
          else off.delete(id);
          return { disabledIds: Array.from(off) };
        }),

      setSystemOverride: (id, override) =>
        set((state) => {
          const existing = state.systemOverrides[id] ?? {};
          const next = { ...existing, ...override };
          if (next.name === "") delete next.name;
          if (next.prompt === "") delete next.prompt;
          if (Object.keys(next).length === 0) {
            const { [id]: _, ...rest } = state.systemOverrides;
            return { systemOverrides: rest };
          }
          return { systemOverrides: { ...state.systemOverrides, [id]: next } };
        }),

      resetSystemOverride: (id) =>
        set((state) => {
          if (!(id in state.systemOverrides)) return state;
          const { [id]: _, ...rest } = state.systemOverrides;
          return { systemOverrides: rest };
        }),

      upsertCustomTool: (tool) =>
        set((state) => {
          if (
            !state.customTools.some((t) => t.id === tool.id) &&
            customIdExists(state, tool.id)
          ) {
            return state;
          }
          const idx = state.customTools.findIndex((t) => t.id === tool.id);
          if (idx === -1) {
            return { customTools: [...state.customTools, tool] };
          }
          const next = state.customTools.slice();
          next[idx] = tool;
          return { customTools: next };
        }),

      removeCustomTool: (id) =>
        set((state) => ({
          customTools: state.customTools.filter((t) => t.id !== id),
          disabledIds: state.disabledIds.filter((d) => d !== id),
          burgerHiddenIds: state.burgerHiddenIds.filter((d) => d !== id),
          projectInitOrder: state.projectInitOrder.filter((p) => p !== id),
          slashCommandIds: state.slashCommandIds.filter((p) => p !== id),
        })),

      toggleProjectInit: (id, enabled) =>
        set((state) => ({
          projectInitOrder: enabled
            ? state.projectInitOrder.includes(id)
              ? state.projectInitOrder
              : [...state.projectInitOrder, id]
            : state.projectInitOrder.filter((x) => x !== id),
        })),

      reorderProjectInit: (order) =>
        set((state) => ({
          projectInitOrder: order.filter((id) =>
            state.projectInitOrder.includes(id),
          ),
        })),

      toggleSlashCommand: (id, enabled) =>
        set((state) => ({
          slashCommandIds: enabled
            ? state.slashCommandIds.includes(id)
              ? state.slashCommandIds
              : [...state.slashCommandIds, id]
            : state.slashCommandIds.filter((x) => x !== id),
        })),
    }),
    {
      name: "opencode-tools",
      partialize: (state) => ({
        disabledIds: state.disabledIds,
        burgerHiddenIds: state.burgerHiddenIds,
        systemOverrides: state.systemOverrides,
        customTools: state.customTools,
        projectInitOrder: state.projectInitOrder,
        slashCommandIds: state.slashCommandIds,
      }),
    },
  ),
);
