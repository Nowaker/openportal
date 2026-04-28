import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SidebarExpandState {
  expanded: string[];
  toggle: (key: string) => void;
  expand: (key: string) => void;
  collapse: (key: string) => void;
  isExpanded: (key: string) => boolean;
}

export const useSidebarExpandStore = create<SidebarExpandState>()(
  persist(
    (set, get) => ({
      expanded: [],
      toggle: (key) =>
        set((state) => ({
          expanded: state.expanded.includes(key)
            ? state.expanded.filter((k) => k !== key)
            : [...state.expanded, key],
        })),
      expand: (key) =>
        set((state) =>
          state.expanded.includes(key)
            ? state
            : { expanded: [...state.expanded, key] },
        ),
      collapse: (key) =>
        set((state) => ({
          expanded: state.expanded.filter((k) => k !== key),
        })),
      isExpanded: (key) => get().expanded.includes(key),
    }),
    {
      name: "opencode-sidebar-expand",
    },
  ),
);
