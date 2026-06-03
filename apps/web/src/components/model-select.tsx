import { useEffect, useMemo } from "react";
import { SelectValue } from "react-aria-components";
import { ChevronUpDownIcon } from "@heroicons/react/24/outline";
import { Select, SelectTrigger } from "@/components/ui/select";
import { ModelPickerContent } from "@/components/model-picker-content";
import { shortenModelName } from "@/lib/model-name";
import { useModelStore } from "@/stores/model-store";
import { useThinkingStore } from "@/stores/thinking-store";
import { useAgents, useProviders } from "@/hooks/use-opencode";
import { useAgentStore } from "@/stores/agent-store";
import { useLastPickedTracker } from "@/stores/last-picked-tracker-store";
import { variantsForModel, pickClosestVariant } from "@/lib/variant-fallback";

interface ProviderRaw {
  id: string;
  name: string;
  models: Record<string, { id: string; name: string }>;
}

interface ModelsData {
  defaultModel: string | null;
  defaultModelName: string | null;
}

function transformProviders(data: {
  providers?: ProviderRaw[];
  default?: Record<string, string>;
}): ModelsData {
  const providers = data?.providers || [];
  const defaults = data?.default || {};

  let defaultModel: string | null = null;
  for (const [providerId, modelId] of Object.entries(defaults)) {
    if (modelId) {
      defaultModel = `${providerId}/${modelId}`;
      break;
    }
  }

  let defaultModelName: string | null = null;
  if (defaultModel) {
    const [pid, ...rest] = defaultModel.split("/");
    const mid = rest.join("/");
    const provider = providers.find((p) => p.id === pid);
    const model = provider ? provider.models[mid] : undefined;
    defaultModelName = model?.name ?? defaultModel;
  }

  return { defaultModel, defaultModelName };
}

const USE_DEFAULT_KEY = "__use_default__";

interface ModelSelectProps {
  // The session this picker is bound to. Per-session selection sits at
  // the top of the four-layer fallback chain in the model store. When
  // null/undefined, the picker still works but its selection lands in
  // the instance and global layers only (used in the Settings page).
  sessionId?: string | null;
  // Identifies which opencode server we're connected to so the
  // store can remember "last used on this server" independently from
  // "last used globally". Same shape as agent-store.
  instanceId?: string | null;
}

export function ModelSelect({ sessionId, instanceId }: ModelSelectProps = {}) {
  const { data: rawData, isLoading } = useProviders();

  const resolvedKey = useModelStore((s) =>
    s.resolveModelKey(sessionId ?? null, instanceId ?? null),
  );
  const setModelForSession = useModelStore((s) => s.setModelForSession);
  const clearSessionModel = useModelStore((s) => s.clearSessionModel);
  const currentVariant = useThinkingStore((s) => s.resolve(sessionId ?? null));
  const setVariantForSession = useThinkingStore((s) => s.setForSession);
  const setVariantDefault = useThinkingStore((s) => s.setDefault);
  const { data: agentsData } = useAgents();
  const currentAgentName = useAgentStore((s) =>
    sessionId ? s.getSelectedAgent(sessionId) : null,
  );
  const setSelectedAgent = useAgentStore((s) => s.setSelectedAgent);
  const setLastUsedAgentForInstance = useAgentStore(
    (s) => s.setLastUsedAgentForInstance,
  );
  const setLastUsedAgentGlobal = useAgentStore((s) => s.setLastUsedAgentGlobal);
  const recordModelPick = useLastPickedTracker((s) => s.recordModelPick);
  const setInstanceDefaultModel = useModelStore(
    (s) => s.setInstanceDefaultModel,
  );
  const setModelFromDefault = useModelStore((s) => s.setModelFromDefault);
  const isOverridingDefault = useModelStore((s) =>
    s.isOverridingDefault(sessionId ?? null, instanceId ?? null),
  );
  // The "default" in the dropdown is whatever the resolver would return
  // if this session had no explicit pick. We compute it from the store
  // by resolving with a sentinel sessionId guaranteed to be absent.
  const effectiveDefaultKey = useModelStore((s) =>
    s.resolveModelKey("__no_session__", instanceId ?? null),
  );

  const data = useMemo(
    () => (rawData ? transformProviders(rawData) : null),
    [rawData],
  );
  const defaultModel = data?.defaultModel ?? null;
  const defaultModelName = useMemo(() => {
    if (!effectiveDefaultKey) return null;
    const [pid, ...rest] = effectiveDefaultKey.split("/");
    const mid = rest.join("/");
    const raw = rawData as
      | { providers?: Array<{ id: string; models?: Record<string, { id: string; name?: string }> }> }
      | null
      | undefined;
    const provider = raw?.providers?.find((p) => p.id === pid);
    const model = provider?.models?.[mid];
    return model?.name ?? effectiveDefaultKey;
  }, [effectiveDefaultKey, rawData]);

  useEffect(() => {
    if (defaultModel) {
      setModelFromDefault(defaultModel);
    }
  }, [defaultModel, setModelFromDefault]);

  return (
    <Select
      aria-label="Model"
      placeholder={isLoading ? "Loading models..." : "Select a model"}
      className="w-full min-w-0"
      selectedKey={isOverridingDefault ? resolvedKey : USE_DEFAULT_KEY}
      onSelectionChange={(key) => {
        if (!key) return;
        if (String(key) === USE_DEFAULT_KEY) {
          // "Use default" means: forget the per-session pick so the next
          // resolution falls through to instance/global/workspace default.
          if (sessionId) clearSessionModel(sessionId);
          return;
        }
        const value = String(key);
        if (sessionId) {
          setModelForSession(sessionId, value, instanceId ?? null);
        } else {
          // new-session composer (no sessionId yet): write to the
          // instance + global last-used layers so the picked model
          // is what resolveModelKey returns at submit time AND
          // becomes the default for future new-session screens.
          setInstanceDefaultModel(value, instanceId ?? null);
        }
        if (currentAgentName) {
          recordModelPick(sessionId ?? null, currentAgentName, value);
        }
        const [pid, ...rest] = value.split("/");
        const mid = rest.join("/");
        const available = variantsForModel(rawData ?? undefined, pid, mid);
        const next = pickClosestVariant(currentVariant, available);
        if (next !== currentVariant) {
          if (sessionId) setVariantForSession(sessionId, next);
          else setVariantDefault(next);
        }
        if (currentAgentName?.includes(" - ") && agentsData) {
          const list = agentsData as Array<{
            name: string;
            model?: { providerID?: string; modelID?: string } | null;
          }>;
          const current = list.find((a) => a.name === currentAgentName);
          const currentProvider = current?.model?.providerID;
          if (currentProvider && pid && currentProvider !== pid) {
            const target = list.find(
              (a) =>
                a.name.includes(" - ") &&
                a.model?.providerID === pid &&
                a.name !== currentAgentName,
            );
            if (target) {
              if (sessionId) setSelectedAgent(sessionId, target.name, instanceId ?? null);
              else {
                setLastUsedAgentForInstance(instanceId ?? null, target.name);
                setLastUsedAgentGlobal(target.name);
              }
            }
          }
        }
      }}
    >
      <SelectTrigger
        className="w-full min-w-0 text-xs sm:text-sm"
        title={isOverridingDefault && resolvedKey ? `Model: ${resolvedKey}` : "Use default model"}
      >
        <SelectValue
          data-slot="select-value"
          className="truncate text-start text-sm/6 data-placeholder:text-muted-fg [&_[slot=description]]:hidden"
        >
          {({ defaultChildren, selectedText, isPlaceholder }) => {
            if (isPlaceholder) return defaultChildren;
            const text = String(selectedText ?? "");
            return shortenModelName(text) || text;
          }}
        </SelectValue>
        <ChevronUpDownIcon
          data-slot="chevron"
          className="-mr-1 ml-auto size-5 text-muted-fg sm:size-4"
        />
      </SelectTrigger>
      <ModelPickerContent
        providersData={rawData}
        defaultKey={effectiveDefaultKey}
        extraEntries={
          defaultModelName
            ? [
                {
                  id: USE_DEFAULT_KEY,
                  label: defaultModelName,
                  trailing: "(default)",
                },
              ]
            : undefined
        }
        ariaLabel="Model"
      />
    </Select>
  );
}
