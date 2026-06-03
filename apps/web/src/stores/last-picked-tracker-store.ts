import { create } from "zustand";
import { persist } from "zustand/middleware";
import { familyName } from "./model-auto-switch-store";
import { parseModelId } from "@/lib/model-version";

interface AgentPick {
  modelKey?: string;
  variant?: string;
  perFamily?: Record<string, { modelKey: string }>;
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
  getGlobalForFamily: (
    agentName: string,
    familyKey: string,
  ) => { modelKey?: string };
  getSessionForFamily: (
    sessionId: string | null,
    agentName: string,
    familyKey: string,
  ) => { modelKey?: string };
}

function merge(prev: AgentPick | undefined, next: Partial<AgentPick>): AgentPick {
  return {
    modelKey: next.modelKey !== undefined ? next.modelKey : prev?.modelKey,
    variant: next.variant !== undefined ? next.variant : prev?.variant,
    perFamily:
      next.perFamily !== undefined
        ? { ...(prev?.perFamily ?? {}), ...next.perFamily }
        : prev?.perFamily,
  };
}

function familyKeyOf(modelKey: string): string {
  const [providerID, ...rest] = modelKey.split("/");
  return parseModelId(providerID, rest.join("/")).familyKey;
}

export const useLastPickedTracker = create<State>()(
  persist(
    (set, get) => ({
      global: {},
      bySession: {},
      recordModelPick: (sessionId, agentName, modelKey) => {
        const family = familyName(agentName);
        if (!family || !modelKey) return;
        const famKey = familyKeyOf(modelKey);
        const delta = {
          modelKey,
          perFamily: famKey ? { [famKey]: { modelKey } } : undefined,
        };
        set((s) => {
          const nextGlobal = { ...s.global, [family]: merge(s.global[family], delta) };
          if (!sessionId) return { global: nextGlobal };
          const sessionMap = s.bySession[sessionId] ?? {};
          return {
            global: nextGlobal,
            bySession: {
              ...s.bySession,
              [sessionId]: { ...sessionMap, [family]: merge(sessionMap[family], delta) },
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
      getGlobalForFamily: (agentName, familyKey) => {
        const family = familyName(agentName);
        const pick = get().global[family]?.perFamily?.[familyKey];
        return pick ?? {};
      },
      getSessionForFamily: (sessionId, agentName, familyKey) => {
        const family = familyName(agentName);
        if (!sessionId) {
          return get().global[family]?.perFamily?.[familyKey] ?? {};
        }
        return (
          get().bySession[sessionId]?.[family]?.perFamily?.[familyKey] ?? {}
        );
      },
    }),
    { name: "openportal-last-picked-tracker" },
  ),
);
