import { create } from "zustand";
import { persist } from "zustand/middleware";

// Empty string => no variant (default model behaviour, no extra reasoning
// budget). Anything else is a variant key as exposed by opencode's
// `/config/providers` -> models[<modelID>].variants. Common variant names
// across providers: low, medium, high, max. Per-model availability varies.
export type ThinkingEffort = string;

interface ThinkingState {
  perSession: Record<string, ThinkingEffort>;
  defaultEffort: ThinkingEffort;
  resolve: (sessionId: string | null | undefined) => ThinkingEffort;
  setForSession: (sessionId: string, effort: ThinkingEffort) => void;
  clearForSession: (sessionId: string) => void;
  setDefault: (effort: ThinkingEffort) => void;
}

export const useThinkingStore = create<ThinkingState>()(
  persist(
    (set, get) => ({
      perSession: {},
      defaultEffort: "",
      resolve: (sessionId) => {
        if (sessionId) {
          const v = get().perSession[sessionId];
          if (typeof v === "string") return v;
        }
        return get().defaultEffort;
      },
      setForSession: (sessionId, effort) =>
        set((s) => ({
          perSession: { ...s.perSession, [sessionId]: effort },
        })),
      clearForSession: (sessionId) =>
        set((s) => {
          const next = { ...s.perSession };
          delete next[sessionId];
          return { perSession: next };
        }),
      setDefault: (effort) => set({ defaultEffort: effort }),
    }),
    {
      name: "opencode-thinking-effort",
    },
  ),
);
