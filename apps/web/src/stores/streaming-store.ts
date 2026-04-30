import { create } from "zustand";
import { persist } from "zustand/middleware";

interface StreamingState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useStreamingStore = create<StreamingState>()(
  persist(
    (set) => ({
      enabled: false,
      setEnabled: (enabled) => set({ enabled }),
    }),
    { name: "opencode-streaming-mode" },
  ),
);
