import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DefaultAgentStrategy = "specific" | "last-used";

interface AgentState {
  selectedAgents: Record<string, string | undefined>;
  // Most-recent agent picked on a given instance (keyed by instance.id), used
  // to seed brand-new sessions on the same instance with the same agent the
  // user last picked there.
  lastUsedAgentByInstance: Record<string, string>;
  // Most-recent agent picked across any instance ever, last-resort fallback
  // for the layered default-agent strategy.
  lastUsedAgentGlobal: string | null;
  defaultAgentStrategy: DefaultAgentStrategy;
  defaultAgentName: string;
  setSelectedAgent: (
    sessionId: string,
    agent: string,
    instanceId?: string | null,
  ) => void;
  getSelectedAgent: (
    sessionId: string | null | undefined,
  ) => string | undefined;
  getLastUsedAgentForInstance: (instanceId: string | null | undefined) => string | null;
  setDefaultAgentStrategy: (strategy: DefaultAgentStrategy) => void;
  setDefaultAgentName: (name: string) => void;
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
      selectedAgents: {},
      lastUsedAgentByInstance: {},
      lastUsedAgentGlobal: null,
      defaultAgentStrategy: "last-used",
      defaultAgentName: "plan",
      setSelectedAgent: (sessionId, agent, instanceId) =>
        set((state) => ({
          selectedAgents: { ...state.selectedAgents, [sessionId]: agent },
          lastUsedAgentByInstance: instanceId
            ? { ...state.lastUsedAgentByInstance, [instanceId]: agent }
            : state.lastUsedAgentByInstance,
          lastUsedAgentGlobal: agent,
        })),
      getSelectedAgent: (sessionId) => {
        if (!sessionId) return undefined;
        return get().selectedAgents[sessionId];
      },
      getLastUsedAgentForInstance: (instanceId) => {
        if (!instanceId) return null;
        return get().lastUsedAgentByInstance[instanceId] ?? null;
      },
      setDefaultAgentStrategy: (strategy) =>
        set({ defaultAgentStrategy: strategy }),
      setDefaultAgentName: (name) => set({ defaultAgentName: name }),
    }),
    {
      name: "portal-agent",
      partialize: (state) => ({
        lastUsedAgentByInstance: state.lastUsedAgentByInstance,
        lastUsedAgentGlobal: state.lastUsedAgentGlobal,
        defaultAgentStrategy: state.defaultAgentStrategy,
        defaultAgentName: state.defaultAgentName,
      }),
    },
  ),
);
