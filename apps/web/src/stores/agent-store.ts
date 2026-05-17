import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AgentState {
  selectedAgents: Record<string, string | undefined>;
  // Most-recent agent picked on a given instance (keyed by instance.id), used
  // to seed brand-new sessions on the same instance with the same agent the
  // user last picked there.
  lastUsedAgentByInstance: Record<string, string>;
  // Most-recent agent picked across any instance ever, last-resort fallback
  // for the layered default-agent strategy.
  lastUsedAgentGlobal: string | null;
  setSelectedAgent: (
    sessionId: string,
    agent: string,
    instanceId?: string | null,
  ) => void;
  getSelectedAgent: (
    sessionId: string | null | undefined,
  ) => string | undefined;
  getLastUsedAgentForInstance: (instanceId: string | null | undefined) => string | null;
  setLastUsedAgentForInstance: (instanceId: string | null | undefined, agent: string | null) => void;
  setLastUsedAgentGlobal: (agent: string | null) => void;
  // Resolved agent for a NEW session on a given instance: per-server override
  // first, then global default. Returns null if neither is set (opencode
  // picks its own default).
  resolveDefaultAgent: (instanceId: string | null | undefined) => string | null;
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
      selectedAgents: {},
      lastUsedAgentByInstance: {},
      lastUsedAgentGlobal: null,
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
      setLastUsedAgentForInstance: (instanceId, agent) => {
        if (!instanceId) return;
        set((state) => {
          const next = { ...state.lastUsedAgentByInstance };
          if (agent === null) {
            delete next[instanceId];
          } else {
            next[instanceId] = agent;
          }
          return { lastUsedAgentByInstance: next };
        });
      },
      setLastUsedAgentGlobal: (agent) => set({ lastUsedAgentGlobal: agent }),
      resolveDefaultAgent: (instanceId) => {
        const state = get();
        const perServer = instanceId
          ? state.lastUsedAgentByInstance[instanceId]
          : undefined;
        return perServer ?? state.lastUsedAgentGlobal ?? null;
      },
    }),
    {
      name: "portal-agent",
      partialize: (state) => ({
        lastUsedAgentByInstance: state.lastUsedAgentByInstance,
        lastUsedAgentGlobal: state.lastUsedAgentGlobal,
      }),
    },
  ),
);
