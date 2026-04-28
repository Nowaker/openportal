import { create } from "zustand";
import { persist } from "zustand/middleware";

interface VirtualSessionState {
  directory: string | null;
  setDirectory: (dir: string | null) => void;
  clear: () => void;
}

export const useVirtualSessionStore = create<VirtualSessionState>()(
  persist(
    (set) => ({
      directory: null,
      setDirectory: (directory) => set({ directory }),
      clear: () => set({ directory: null }),
    }),
    {
      name: "opencode-virtual-session",
    },
  ),
);
