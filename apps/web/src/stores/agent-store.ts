import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DefaultAgentStrategy = "specific" | "last-used";

interface AgentState {
  selectedAgents: Record<string, string | undefined>;
  lastUsedAgent: string | null;
  defaultAgentStrategy: DefaultAgentStrategy;
  defaultAgentName: string;
  setSelectedAgent: (sessionId: string, agent: string) => void;
  getSelectedAgent: (
    sessionId: string | null | undefined,
  ) => string | undefined;
  setDefaultAgentStrategy: (strategy: DefaultAgentStrategy) => void;
  setDefaultAgentName: (name: string) => void;
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
      selectedAgents: {},
      lastUsedAgent: null,
      defaultAgentStrategy: "last-used",
      defaultAgentName: "plan",
      setSelectedAgent: (sessionId, agent) =>
        set((state) => ({
          selectedAgents: { ...state.selectedAgents, [sessionId]: agent },
          lastUsedAgent: agent,
        })),
      getSelectedAgent: (sessionId) => {
        if (!sessionId) return undefined;
        return get().selectedAgents[sessionId];
      },
      setDefaultAgentStrategy: (strategy) =>
        set({ defaultAgentStrategy: strategy }),
      setDefaultAgentName: (name) => set({ defaultAgentName: name }),
    }),
    {
      name: "portal-agent",
      partialize: (state) => ({
        lastUsedAgent: state.lastUsedAgent,
        defaultAgentStrategy: state.defaultAgentStrategy,
        defaultAgentName: state.defaultAgentName,
      }),
    },
  ),
);
