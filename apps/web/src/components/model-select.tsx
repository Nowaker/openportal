import { useEffect, useMemo } from "react";
import { SelectValue } from "react-aria-components";
import { ChevronUpDownIcon } from "@heroicons/react/24/outline";
import { Select, SelectTrigger } from "@/components/ui/select";
import { ModelPickerContent } from "@/components/model-picker-content";
import { shortenModelName } from "@/lib/model-name";
import { useModelStore } from "@/stores/model-store";
import { useThinkingStore } from "@/stores/thinking-store";
import { useAgents } from "@/hooks/use-opencode";
import { useAgentStore } from "@/stores/agent-store";
import { useLastPickedTracker } from "@/stores/last-picked-tracker-store";
import { variantsForModel, pickClosestVariant } from "@/lib/variant-fallback";
import { useVisibleProviders } from "@/hooks/use-visible-providers";

function firstDefaultModel(data: {
  default?: Record<string, string>;
}): string | null {
  for (const [providerId, modelId] of Object.entries(data?.default || {})) {
    if (modelId) return `${providerId}/${modelId}`;
  }
  return null;
}

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
  const resolvedKey = useModelStore((s) =>
    s.resolveModelKey(sessionId ?? null, instanceId ?? null),
  );
  // The selected model must stay a row of the list even when Settings ->
  // Models hides it, or the trigger would fall back to its placeholder.
  const { data: rawData, isLoading } = useVisibleProviders(resolvedKey);
  const setModelForSession = useModelStore((s) => s.setModelForSession);
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

  const defaultModel = useMemo(
    () => (rawData ? firstDefaultModel(rawData) : null),
    [rawData],
  );

  // List rows are labelled by version inside their family group ("5.5"),
  // which is ambiguous once the group heading is out of sight.
  const selectedModelName = useMemo(() => {
    const slash = resolvedKey.indexOf("/");
    if (slash <= 0) return null;
    const raw = rawData as
      | { providers?: Array<{ id: string; models?: Record<string, { name?: string }> }> }
      | undefined;
    const provider = raw?.providers?.find((p) => p.id === resolvedKey.slice(0, slash));
    return provider?.models?.[resolvedKey.slice(slash + 1)]?.name ?? null;
  }, [rawData, resolvedKey]);

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
      selectedKey={resolvedKey}
      onSelectionChange={(key) => {
        if (!key) return;
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
      <SelectTrigger className="w-full min-w-0 text-xs sm:text-sm">
        <SelectValue
          data-slot="select-value"
          className="truncate text-start text-sm/6 data-placeholder:text-muted-fg [&_[slot=description]]:hidden"
        >
          {({ defaultChildren, selectedText, isPlaceholder }) => {
            if (isPlaceholder) return defaultChildren;
            const text = selectedModelName ?? String(selectedText ?? "");
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
        defaultKey={defaultModel}
        ariaLabel="Model"
      />
    </Select>
  );
}
