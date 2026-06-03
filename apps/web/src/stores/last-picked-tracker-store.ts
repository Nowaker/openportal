import { create } from "zustand";
import { persist } from "zustand/middleware";
import { familyName } from "./model-auto-switch-store";

interface AgentPick {
  modelKey?: string;
  variant?: string;
}

interface State {
  global: Record<string, AgentPick>;
  bySession: Record<string, Record<string, AgentPick>>;
  recordModelPick: (
    sessionId: string | null,
    agentName: string,
    modelKey: string,
  ) => void;
  recordVariantPick: (
    sessionId: string | null,
    agentName: string,
    variant: string,
  ) => void;
  getGlobal: (agentName: string) => AgentPick;
  getSession: (sessionId: string | null, agentName: string) => AgentPick;
}

function merge(prev: AgentPick | undefined, next: Partial<AgentPick>): AgentPick {
  return {
    modelKey: next.modelKey !== undefined ? next.modelKey : prev?.modelKey,
    variant: next.variant !== undefined ? next.variant : prev?.variant,
  };
}

export const useLastPickedTracker = create<State>()(
  persist(
    (set, get) => ({
      global: {},
      bySession: {},
      recordModelPick: (sessionId, agentName, modelKey) => {
        const family = familyName(agentName);
        if (!family || !modelKey) return;
        set((s) => {
          const nextGlobal = { ...s.global, [family]: merge(s.global[family], { modelKey }) };
          if (!sessionId) return { global: nextGlobal };
          const sessionMap = s.bySession[sessionId] ?? {};
          return {
            global: nextGlobal,
            bySession: {
              ...s.bySession,
              [sessionId]: { ...sessionMap, [family]: merge(sessionMap[family], { modelKey }) },
            },
          };
        });
      },
      recordVariantPick: (sessionId, agentName, variant) => {
        const family = familyName(agentName);
        if (!family) return;
        set((s) => {
          const nextGlobal = { ...s.global, [family]: merge(s.global[family], { variant }) };
          if (!sessionId) return { global: nextGlobal };
          const sessionMap = s.bySession[sessionId] ?? {};
          return {
            global: nextGlobal,
            bySession: {
              ...s.bySession,
              [sessionId]: { ...sessionMap, [family]: merge(sessionMap[family], { variant }) },
            },
          };
        });
      },
      getGlobal: (agentName) => {
        const family = familyName(agentName);
        return get().global[family] ?? {};
      },
      getSession: (sessionId, agentName) => {
        if (!sessionId) return get().getGlobal(agentName);
        const family = familyName(agentName);
        return get().bySession[sessionId]?.[family] ?? {};
      },
    }),
    { name: "openportal-last-picked-tracker" },
  ),
);
