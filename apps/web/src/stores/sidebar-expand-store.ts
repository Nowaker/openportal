import { create } from "zustand";
import { persist } from "zustand/middleware";

// Two parallel sets:
//   expanded[]        - user explicitly opened this node
//   forceCollapsed[]  - user explicitly closed a node that auto-expand wants
//                       open (e.g., subsessions with active children).
// Without forceCollapsed, auto-expand always wins and the user can never
// dismiss an actively-running subsession list. Resolution: forceCollapsed
// is the strongest signal (user explicit collapse), then expanded (user
// explicit open), then auto-expand fallback computed by the consumer.
interface SidebarExpandState {
  expanded: string[];
  forceCollapsed: string[];
  toggle: (key: string) => void;
  expand: (key: string) => void;
  collapse: (key: string) => void;
  isExpanded: (key: string) => boolean;
  setExplicitCollapsed: (key: string, collapsed: boolean) => void;
  isForceCollapsed: (key: string) => boolean;
}

export const useSidebarExpandStore = create<SidebarExpandState>()(
  persist(
    (set, get) => ({
      expanded: [],
      forceCollapsed: [],
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
      setExplicitCollapsed: (key, collapsed) =>
        set((state) => ({
          forceCollapsed: collapsed
            ? state.forceCollapsed.includes(key)
              ? state.forceCollapsed
              : [...state.forceCollapsed, key]
            : state.forceCollapsed.filter((k) => k !== key),
          expanded: collapsed
            ? state.expanded.filter((k) => k !== key)
            : state.expanded,
        })),
      isForceCollapsed: (key) => get().forceCollapsed.includes(key),
    }),
    {
      name: "opencode-sidebar-expand",
    },
  ),
);
