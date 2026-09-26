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

export interface ObservedSessionModel {
  key: string;
  // `time.created` of the message that carried this model.
  at: number;
}

type MessageModelSource = {
  info: {
    role?: string;
    providerID?: unknown;
    modelID?: unknown;
    model?: unknown;
    time?: { created?: unknown };
  };
};

// The model the session actually ran on most recently: assistant messages
// carry `providerID`/`modelID`, user messages carry `model`. Whoever drove
// the session (this portal, another portal tab, the TUI) leaves it here.
export function latestMessageModel(
  messages: ReadonlyArray<MessageModelSource>,
): ObservedSessionModel | null {
  let best: ObservedSessionModel | null = null;
  for (const { info } of messages) {
    const at = typeof info.time?.created === "number" ? info.time.created : 0;
    if (best && at < best.at) continue;
    const ref =
      info.role === "assistant"
        ? info
        : (info.model as { providerID?: unknown; modelID?: unknown } | undefined);
    if (
      typeof ref?.providerID === "string" &&
      ref.providerID &&
      typeof ref.modelID === "string" &&
      ref.modelID
    ) {
      best = { key: `${ref.providerID}/${ref.modelID}`, at };
    }
  }
  return best;
}

interface ModelState {
  // Layer 1: per-session pick made in this browser. Wins while it is newer
  // than the session's latest message (see selectedAtBySession).
  selectedModelBySession: Record<string, string>;
  // When each layer-1 pick was made. Picks without a timestamp predate
  // this field and lose to any observed session model.
  selectedAtBySession: Record<string, number>;
  // Layer 1b: the model the session's latest message ran on. Not
  // persisted - rebuilt from messages whenever the session is viewed.
  observedModelBySession: Record<string, ObservedSessionModel>;
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
  // Record the model the session's latest message ran on. Older
  // observations never replace newer ones.
  observeSessionModel: (
    sessionId: string,
    observed: ObservedSessionModel,
  ) => void;

  setModelFromDefault: (defaultKey: string | null) => void;
  isOverridingDefault: (
    sessionId: string | null | undefined,
    instanceId: string | null | undefined,
  ) => boolean;
}

function sessionLayerKey(
  state: Pick<
    ModelState,
    "selectedModelBySession" | "selectedAtBySession" | "observedModelBySession"
  >,
  sessionId: string,
): string | null {
  const picked = state.selectedModelBySession[sessionId];
  const observed = state.observedModelBySession[sessionId];
  if (picked && (!observed || (state.selectedAtBySession[sessionId] ?? 0) >= observed.at)) {
    return picked;
  }
  return observed?.key ?? null;
}

export const useModelStore = create<ModelState>()(
  persist(
    (set, get) => ({
      selectedModelBySession: {},
      selectedAtBySession: {},
      observedModelBySession: {},
      lastUsedModelByInstance: {},
      lastUsedModelGlobal: null,
      defaultModelKey: null,
      isInitialized: true,

      resolveModel: (sessionId, instanceId) => {
        const state = get();
        const sessionKey = sessionId ? sessionLayerKey(state, sessionId) : null;
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
          selectedAtBySession: {
            ...state.selectedAtBySession,
            [sessionId]: Date.now(),
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

      observeSessionModel: (sessionId, observed) =>
        set((state) => {
          const current = state.observedModelBySession[sessionId];
          if (
            current &&
            (current.at > observed.at ||
              (current.at === observed.at && current.key === observed.key))
          ) {
            return state;
          }
          return {
            observedModelBySession: {
              ...state.observedModelBySession,
              [sessionId]: observed,
            },
          };
        }),

      setModelFromDefault: (defaultKey) => {
        if (defaultKey) {
          set({ defaultModelKey: defaultKey });
        }
      },

      // True iff the prompt sender must forward a `model` to opencode.
      // A session with its own model (a pick here, or the model its latest
      // message ran on) always sends it: omitting it lets opencode fall
      // back to the agent's model, which would silently switch models
      // whenever the session's model happens to equal the server default.
      isOverridingDefault: (sessionId, instanceId) => {
        const state = get();
        if (sessionId && sessionLayerKey(state, sessionId)) return true;
        if (!state.defaultModelKey) return false;
        return (
          state.resolveModelKey(sessionId, instanceId) !== state.defaultModelKey
        );
      },
    }),
    {
      name: "opencode-selected-model",
      partialize: (state) => ({
        selectedModelBySession: state.selectedModelBySession,
        selectedAtBySession: state.selectedAtBySession,
        lastUsedModelByInstance: state.lastUsedModelByInstance,
        lastUsedModelGlobal: state.lastUsedModelGlobal,
        defaultModelKey: state.defaultModelKey,
      }),
    },
  ),
);
