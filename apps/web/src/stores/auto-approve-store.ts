import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface AutoApproveState {
  enabled: Record<string, boolean>;
  isEnabled: (sessionId: string | null) => boolean;
  setEnabled: (sessionId: string, value: boolean) => void;
  toggle: (sessionId: string) => void;
}

export const useAutoApproveStore = create<AutoApproveState>()(
  persist(
    (set, get) => ({
      enabled: {},
      isEnabled: (sessionId) => {
        if (!sessionId) return false;
        return Boolean(get().enabled[sessionId]);
      },
      setEnabled: (sessionId, value) =>
        set((s) => ({
          enabled: { ...s.enabled, [sessionId]: value },
        })),
      toggle: (sessionId) =>
        set((s) => ({
          enabled: { ...s.enabled, [sessionId]: !s.enabled[sessionId] },
        })),
    }),
    {
      name: "openportal-auto-approve",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
