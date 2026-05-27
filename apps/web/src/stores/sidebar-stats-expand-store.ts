import { create } from "zustand";
import { persist } from "zustand/middleware";

// Per-browser preference: is the sidebar resources/CPU indicator
// rendered in its compact horizontal row (false, default) or in the
// detailed 2-column grid (true). Persisted to localStorage so the
// choice survives reloads. Not URL-driven — this is a widget mode,
// not a navigable state.
interface SidebarStatsExpandState {
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  toggle: () => void;
}

export const useSidebarStatsExpandStore = create<SidebarStatsExpandState>()(
  persist(
    (set, get) => ({
      expanded: false,
      setExpanded: (expanded) => set({ expanded }),
      toggle: () => set({ expanded: !get().expanded }),
    }),
    {
      name: "openportal-sidebar-stats-expand",
    },
  ),
);
