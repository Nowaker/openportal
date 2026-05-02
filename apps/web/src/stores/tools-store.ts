import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SYSTEM_TOOLS, type SystemTool } from "@/lib/prompt-tools";

// User-defined tool that lives only in the user's settings (no system
// default to fall back to). resetToDefault is a no-op for these.
export interface CustomTool {
  id: string;
  name: string;
  description?: string;
  prompt: string;
}

// What the topbar Tools menu actually renders, after merging the system
// list with the user's overrides and additions. Discriminated by `kind`
// so callers can offer "reset" only for system tools.
export type ResolvedTool =
  | (SystemTool & { kind: "system"; enabled: boolean; isOverridden: boolean })
  | (CustomTool & { kind: "custom"; enabled: boolean });

interface ToolsPersistedState {
  // Tool ids the user has unchecked in Settings. Default = all enabled.
  // We store the disabled set rather than the enabled set so newly-shipped
  // system tools opt the user IN by default - if we tracked enabled-set,
  // a fresh tool would default to off until the user found Settings.
  disabledIds: string[];
  // Per-tool prompt overrides. Stored as full text rather than as a
  // diff so the system text can change underneath without merge surprises.
  // Drop the override (resetToDefault) to fall back to the system text.
  systemOverrides: Record<string, { name?: string; prompt?: string }>;
  customTools: CustomTool[];
  // Tool ids designated as "project-init templates" with explicit ordering.
  // When the user creates a new project (folder browser triggers the
  // mkdir+git-init flow), these templates are pre-checked in the
  // create-project modal and concatenated (in this order) as the new
  // session's first auto-prompt. Stored as ORDERED array so drag-drop
  // reordering in Settings is the source of truth for concatenation order.
  projectInitOrder: string[];
}

interface ToolsState extends ToolsPersistedState {
  setEnabled: (id: string, enabled: boolean) => void;
  setSystemOverride: (
    id: string,
    override: { name?: string; prompt?: string },
  ) => void;
  resetSystemOverride: (id: string) => void;
  upsertCustomTool: (tool: CustomTool) => void;
  removeCustomTool: (id: string) => void;
  toggleProjectInit: (id: string, enabled: boolean) => void;
  reorderProjectInit: (order: string[]) => void;
}

// Pure derivation: given the persisted slices, return the resolved tool
// list. Components subscribe to the raw slices and call this through a
// useMemo - putting the spread/map inside a Zustand selector returns a
// fresh array identity on every render and triggers React's infinite
// update loop guard (error #185).
export function resolveToolsFromState(
  state: Pick<ToolsPersistedState, "disabledIds" | "systemOverrides" | "customTools">,
): ResolvedTool[] {
  const disabled = new Set(state.disabledIds);
  const systemResolved: ResolvedTool[] = SYSTEM_TOOLS.map((tool) => {
    const override = state.systemOverrides[tool.id] ?? {};
    return {
      ...tool,
      name: override.name ?? tool.name,
      prompt: override.prompt ?? tool.prompt,
      kind: "system" as const,
      enabled: !disabled.has(tool.id),
      isOverridden:
        override.name !== undefined || override.prompt !== undefined,
    };
  });
  const customResolved: ResolvedTool[] = state.customTools.map((tool) => ({
    ...tool,
    kind: "custom" as const,
    enabled: !disabled.has(tool.id),
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
      systemOverrides: {},
      customTools: [],
      projectInitOrder: [],

      setEnabled: (id, enabled) =>
        set((state) => {
          const disabled = new Set(state.disabledIds);
          if (enabled) disabled.delete(id);
          else disabled.add(id);
          return { disabledIds: Array.from(disabled) };
        }),

      setSystemOverride: (id, override) =>
        set((state) => {
          const existing = state.systemOverrides[id] ?? {};
          const next = { ...existing, ...override };
          // Drop empty fields so the resolver falls back cleanly to the
          // system default rather than rendering an explicit empty string.
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
            // ID collision with a system tool. Refuse silently; the
            // settings UI should validate IDs before calling.
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
          // Strip the disabled flag too so re-adding a tool with the same
          // id later doesn't inherit the previous disabled state.
          disabledIds: state.disabledIds.filter((d) => d !== id),
          projectInitOrder: state.projectInitOrder.filter((p) => p !== id),
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
    }),
    {
      name: "opencode-tools",
      partialize: (state) => ({
        disabledIds: state.disabledIds,
        systemOverrides: state.systemOverrides,
        customTools: state.customTools,
        projectInitOrder: state.projectInitOrder,
      }),
    },
  ),
);
