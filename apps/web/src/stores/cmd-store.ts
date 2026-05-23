import { create } from "zustand";

interface CmdState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  setOpen: (v: boolean) => void;
}

export const useCmdStore = create<CmdState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setOpen: (v) => set({ isOpen: v }),
}));
