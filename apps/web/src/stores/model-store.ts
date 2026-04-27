import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SelectedModel {
  providerID: string;
  modelID: string;
}

// Hard-coded fallback used only on first install before opencode reports
// its workspace default. Once `setModelFromDefault` runs, defaultModelKey
// takes priority for fresh sessions.
const HARDCODED_DEFAULT: SelectedModel = {
  providerID: "opencode",
  modelID: "grok-code",
};

function parseModelKey(key: string): SelectedModel {
  const [providerID = "", ...rest] = key.split("/");
  const modelID = rest.join("/");
  return { providerID, modelID };
}

function toModelKey(model: SelectedModel): string {
  return `${model.providerID}/${model.modelID}`;
}

interface ModelState {
  // Layer 1: per-session pick. Wins over everything when set.
  selectedModelBySession: Record<string, string>;
  // Layer 2: most-recent pick on a given instance, used to seed brand-new
  // sessions on the same instance with the same model the user last picked
  // there.
  lastUsedModelByInstance: Record<string, string>;
  // Layer 3: most-recent pick across any instance, last-resort before
  // falling back to the workspace default.
  lastUsedModelGlobal: string | null;
  // Layer 4: workspace default reported by opencode (`/config` -> model).
  // Falls back to HARDCODED_DEFAULT before opencode has reported.
  defaultModelKey: string | null;

  isInitialized: boolean;

  // Resolves the effective model for the given session, applying the
  // four-layer fallback chain.
  resolveModel: (
    sessionId: string | null | undefined,
    instanceId: string | null | undefined,
  ) => SelectedModel;
  resolveModelKey: (
    sessionId: string | null | undefined,
    instanceId: string | null | undefined,
  ) => string;

  // The user picked this model for this session. Also updates the
  // instance-scoped and global last-used pointers so future fresh sessions
  // on the same instance / device pick it up.
  setModelForSession: (
    sessionId: string,
    key: string,
    instanceId: string | null | undefined,
  ) => void;
  // Settings-page version: write instance + global pointers without
  // claiming a per-session pick.
  setInstanceDefaultModel: (
    key: string,
    instanceId: string | null | undefined,
  ) => void;
  // Clear the per-session pick so the session inherits its instance / global
  // / workspace default again.
  clearSessionModel: (sessionId: string) => void;

  setModelFromDefault: (defaultKey: string | null) => void;
  isOverridingDefault: (
    sessionId: string | null | undefined,
    instanceId: string | null | undefined,
  ) => boolean;
}

export const useModelStore = create<ModelState>()(
  persist(
    (set, get) => ({
      selectedModelBySession: {},
      lastUsedModelByInstance: {},
      lastUsedModelGlobal: null,
      defaultModelKey: null,
      isInitialized: true,

      resolveModel: (sessionId, instanceId) => {
        const state = get();
        const sessionKey =
          sessionId && state.selectedModelBySession[sessionId];
        if (sessionKey) return parseModelKey(sessionKey);
        const instanceKey =
          instanceId && state.lastUsedModelByInstance[instanceId];
        if (instanceKey) return parseModelKey(instanceKey);
        if (state.lastUsedModelGlobal) {
          return parseModelKey(state.lastUsedModelGlobal);
        }
        if (state.defaultModelKey) return parseModelKey(state.defaultModelKey);
        return HARDCODED_DEFAULT;
      },

      resolveModelKey: (sessionId, instanceId) =>
        toModelKey(get().resolveModel(sessionId, instanceId)),

      setModelForSession: (sessionId, key, instanceId) =>
        set((state) => ({
          selectedModelBySession: {
            ...state.selectedModelBySession,
            [sessionId]: key,
          },
          lastUsedModelByInstance: instanceId
            ? { ...state.lastUsedModelByInstance, [instanceId]: key }
            : state.lastUsedModelByInstance,
          lastUsedModelGlobal: key,
        })),

      // Settings page version: writes the instance-default and global
      // pointers without claiming a per-session pick. The Settings model
      // dropdown is "default for new sessions on this server", not "model
      // for this session", so we deliberately skip layer 1.
      setInstanceDefaultModel: (key, instanceId) =>
        set((state) => ({
          lastUsedModelByInstance: instanceId
            ? { ...state.lastUsedModelByInstance, [instanceId]: key }
            : state.lastUsedModelByInstance,
          lastUsedModelGlobal: key,
        })),

      clearSessionModel: (sessionId) =>
        set((state) => {
          const next = { ...state.selectedModelBySession };
          delete next[sessionId];
          return { selectedModelBySession: next };
        }),

      setModelFromDefault: (defaultKey) => {
        if (defaultKey) {
          set({ defaultModelKey: defaultKey });
        }
      },

      // True iff the resolved model differs from the workspace default.
      // Used by the prompt sender to decide whether to forward a `model`
      // override to opencode (vs letting opencode use its own default).
      isOverridingDefault: (sessionId, instanceId) => {
        const { defaultModelKey } = get();
        if (!defaultModelKey) return false;
        return get().resolveModelKey(sessionId, instanceId) !== defaultModelKey;
      },
    }),
    {
      name: "opencode-selected-model",
      partialize: (state) => ({
        selectedModelBySession: state.selectedModelBySession,
        lastUsedModelByInstance: state.lastUsedModelByInstance,
        lastUsedModelGlobal: state.lastUsedModelGlobal,
        defaultModelKey: state.defaultModelKey,
      }),
    },
  ),
);
