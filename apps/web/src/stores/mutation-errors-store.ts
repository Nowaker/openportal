import { create } from "zustand";

export type MutationErrorField = "title" | "archived";

export type MutationError = {
  field: MutationErrorField;
  message: string;
  at: number;
};

type State = {
  errors: Record<string, MutationError>;
  setError: (sessionId: string, err: MutationError) => void;
  clearError: (sessionId: string) => void;
};

export const useMutationErrorStore = create<State>((set) => ({
  errors: {},
  setError: (sessionId, err) =>
    set((s) => ({ errors: { ...s.errors, [sessionId]: err } })),
  clearError: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.errors)) return s;
      const next = { ...s.errors };
      delete next[sessionId];
      return { errors: next };
    }),
}));

export function useMutationError(
  sessionId: string | null | undefined,
): MutationError | undefined {
  return useMutationErrorStore((s) =>
    sessionId ? s.errors[sessionId] : undefined,
  );
}
