import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SessionErrorState {
  errors: string[];
  // Per-session: id of the most recently acknowledged failing assistant
  // message. When the live "is the latest assistant message a failure"
  // probe finds a message whose id matches this, the session is treated
  // as already-attended-to and the red indicator stays clear. A NEW
  // failure (different message id) re-surfaces the indicator.
  acknowledged: Record<string, string>;
  setError: (
    sessionId: string,
    hasError: boolean,
    errorMessageId?: string,
  ) => void;
  acknowledge: (sessionId: string, errorMessageId: string) => void;
  clear: (sessionId: string) => void;
  has: (sessionId: string) => boolean;
}

export const useSessionErrorStore = create<SessionErrorState>()(
  persist(
    (set, get) => ({
      errors: [],
      acknowledged: {},
      setError: (sessionId, hasError, errorMessageId) =>
        set((state) => {
          const has = state.errors.includes(sessionId);
          if (hasError) {
            const ackedId = state.acknowledged[sessionId];
            if (errorMessageId && ackedId === errorMessageId) {
              return has
                ? { errors: state.errors.filter((id) => id !== sessionId) }
                : state;
            }
            if (!has) return { errors: [...state.errors, sessionId] };
            return state;
          }
          if (has) {
            return { errors: state.errors.filter((id) => id !== sessionId) };
          }
          return state;
        }),
      acknowledge: (sessionId, errorMessageId) =>
        set((state) => ({
          errors: state.errors.filter((id) => id !== sessionId),
          acknowledged: { ...state.acknowledged, [sessionId]: errorMessageId },
        })),
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
