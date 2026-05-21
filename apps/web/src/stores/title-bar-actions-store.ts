import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ActionPlacement = "hamburger" | "both";

export const SESSION_ACTIONS = [
  {
    id: "compact",
    label: "Compact session",
    description:
      "AI-summarise older history. When set to Both, the title bar gets a Compact icon button alongside the hamburger entry.",
  },
  {
    id: "export",
    label: "Export markdown",
    description:
      "Quick links that download the session as Markdown. The hamburger entry has all three variants (chat / prompts only / full transcript); the title-bar shortcut opens the full chat export.",
  },
] as const;

export type SessionActionId = (typeof SESSION_ACTIONS)[number]["id"];

interface TitleBarActionsState {
  placements: Record<SessionActionId, ActionPlacement>;
  setPlacement: (id: SessionActionId, placement: ActionPlacement) => void;
  reset: () => void;
}

const DEFAULTS: Record<SessionActionId, ActionPlacement> = {
  compact: "hamburger",
  export: "hamburger",
};

export const useTitleBarActionsStore = create<TitleBarActionsState>()(
  persist(
    (set) => ({
      placements: { ...DEFAULTS },
      setPlacement: (id, placement) =>
        set((s) => ({ placements: { ...s.placements, [id]: placement } })),
      reset: () => set({ placements: { ...DEFAULTS } }),
    }),
    { name: "openportal-title-bar-actions" },
  ),
);
