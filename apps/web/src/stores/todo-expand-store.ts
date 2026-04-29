import { create } from "zustand";

interface TodoExpandState {
  expanded: boolean;
  toggle: () => void;
  close: () => void;
}

export const useTodoExpandStore = create<TodoExpandState>((set) => ({
  expanded: false,
  toggle: () => set((s) => ({ expanded: !s.expanded })),
  close: () => set({ expanded: false }),
}));
