import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Instance {
  id: string;
  name: string;
  protocol?: "http" | "https";
  port: number;
  hostname?: string;
  webEndpoint?: string;
}

interface InstanceState {
  instance: Instance | null;
  setInstance: (instance: Instance | null) => void;
  clearInstance: () => void;
}

export const useInstanceStore = create<InstanceState>()(
  persist(
    (set) => ({
      instance: null,
      setInstance: (instance) => set({ instance }),
      clearInstance: () => set({ instance: null }),
    }),
    {
      name: "opencode-instance",
    },
  ),
);
