import { useEffect, useMemo } from "react";
import {
  Autocomplete,
  ListBox,
  Popover,
  useFilter,
} from "react-aria-components";
import { Dialog } from "@/components/ui/dialog";
import { SearchField, SearchInput } from "@/components/ui/search-field";
import {
  Select,
  SelectItem,
  SelectLabel,
  SelectSection,
  SelectTrigger,
} from "@/components/ui/select";
import { useModelStore } from "@/stores/model-store";
import { useProviders } from "@/hooks/use-opencode";
import useMediaQuery from "@/hooks/use-media-query";
import { compareModels } from "@/lib/model-sort";

interface ModelItem {
  id: string;
  name: string;
}

interface ModelData {
  id: string;
  name: string;
  providerID: string;
}

interface Provider {
  id: string;
  name: string;
  models: Record<string, ModelData>;
}

interface ProviderWithModels {
  id: string;
  name: string;
  models: ModelItem[];
}

interface ModelsData {
  providers: ProviderWithModels[];
  defaultModel: string | null;
  defaultModelName: string | null;
}

function transformProviders(data: {
  providers?: Provider[];
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

  const sortedProviders: ProviderWithModels[] = providers
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      models: Object.values(provider.models || {})
        .map((model) => ({
          id: `${provider.id}/${model.id}`,
          name: model.name,
        }))
        .sort(compareModels),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { providers: sortedProviders, defaultModel, defaultModelName };
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
  const { contains } = useFilter({ sensitivity: "base" });
  const { isMobile } = useMediaQuery();

  const resolvedKey = useModelStore((s) =>
    s.resolveModelKey(sessionId ?? null, instanceId ?? null),
  );
  const setModelForSession = useModelStore((s) => s.setModelForSession);
  const clearSessionModel = useModelStore((s) => s.clearSessionModel);
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
  const providers = data?.providers ?? [];
  const defaultModel = data?.defaultModel ?? null;
  const defaultModelName = useMemo(() => {
    if (!effectiveDefaultKey) return null;
    const [pid, ...rest] = effectiveDefaultKey.split("/");
    const mid = rest.join("/");
    const provider = providers.find((p) => p.id === pid);
    const model = provider?.models.find((m) => m.id === effectiveDefaultKey);
    return model?.name ?? effectiveDefaultKey;
  }, [effectiveDefaultKey, providers]);

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
        if (sessionId) {
          setModelForSession(sessionId, String(key), instanceId ?? null);
        }
      }}
    >
      <SelectTrigger className="w-full min-w-0 text-xs sm:text-sm" />
      <Popover className="entering:fade-in exiting:fade-out flex max-h-[min(80vh,32rem)] min-w-(--trigger-width) w-screen max-w-[calc(100vw-1.5rem)] sm:max-w-md entering:animate-in exiting:animate-out flex-col overflow-hidden rounded-lg border bg-overlay">
        <Dialog aria-label="Model">
          <Autocomplete filter={contains}>
            <div className="border-b bg-muted p-2">
              <SearchField
                className="rounded-lg bg-bg [&_input]:!text-sm"
                autoFocus={!isMobile}
              >
                <SearchInput placeholder="Search models..." />
              </SearchField>
            </div>
            <ListBox
              className="grid max-h-[min(70vh,28rem)] w-full grid-cols-[auto_1fr] flex-col gap-y-0.5 overflow-y-auto p-1 text-xs outline-hidden sm:text-sm *:[[role='group']+[role=group]]:mt-3 *:[[role='group']+[role=separator]]:mt-1 [&_[role=option]]:!text-xs sm:[&_[role=option]]:!text-sm [&_[role=option]]:!py-1 sm:[&_[role=option]]:!py-1 [&_[role=group]>[role=presentation]]:!text-xs"
            >
              {defaultModelName && (
                <SelectItem
                  id={USE_DEFAULT_KEY}
                  textValue={`${defaultModelName} (default)`}
                  className="font-medium"
                >
                  <SelectLabel>
                    {defaultModelName}
                    <span className="ml-1 text-muted-fg">(default)</span>
                  </SelectLabel>
                </SelectItem>
              )}
              {providers.map((provider) => (
                <SelectSection
                  key={provider.id}
                  title={provider.name}
                  items={provider.models}
                >
                  {(model) => (
                    <SelectItem id={model.id} textValue={model.name}>
                      <SelectLabel>
                        {model.name}
                        {model.id === effectiveDefaultKey && (
                          <span className="ml-1 text-muted-fg">(default)</span>
                        )}
                      </SelectLabel>
                    </SelectItem>
                  )}
                </SelectSection>
              ))}
            </ListBox>
          </Autocomplete>
        </Dialog>
      </Popover>
    </Select>
  );
}
