import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SessionErrorState {
  errors: string[];
  setError: (sessionId: string, hasError: boolean) => void;
  clear: (sessionId: string) => void;
  has: (sessionId: string) => boolean;
}

export const useSessionErrorStore = create<SessionErrorState>()(
  persist(
    (set, get) => ({
      errors: [],
      setError: (sessionId, hasError) =>
        set((state) => {
          const has = state.errors.includes(sessionId);
          if (hasError && !has) {
            return { errors: [...state.errors, sessionId] };
          }
          if (!hasError && has) {
            return { errors: state.errors.filter((id) => id !== sessionId) };
          }
          return state;
        }),
      clear: (sessionId) =>
        set((state) => ({
          errors: state.errors.filter((id) => id !== sessionId),
        })),
      has: (sessionId) => get().errors.includes(sessionId),
    }),
    {
      name: "opencode-session-errors",
    },
  ),
);
