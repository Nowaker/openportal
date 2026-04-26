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
  SelectSection,
  SelectTrigger,
} from "@/components/ui/select";
import { useModelStore } from "@/stores/model-store";
import { useProviders } from "@/hooks/use-opencode";
import useMediaQuery from "@/hooks/use-media-query";

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

const VERSION_RE = /\d+(?:\.\d+)+/g;

// Sort: case-insensitive alphabetical on the non-numeric portion of the name,
// version-descending when the base names match. So "Claude Haiku 4.5" sorts
// before "Claude Opus 4.7" alphabetically, but "Claude Opus 4.7" sorts before
// "Claude Opus 4.5".
function compareModels(a: ModelItem, b: ModelItem): number {
  const aBase = a.name.replace(VERSION_RE, "").replace(/\s+/g, " ").trim().toLowerCase();
  const bBase = b.name.replace(VERSION_RE, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (aBase !== bBase) return aBase.localeCompare(bBase);

  const aVersions = (a.name.match(VERSION_RE) ?? []).map((v) => v.split(".").map(Number));
  const bVersions = (b.name.match(VERSION_RE) ?? []).map((v) => v.split(".").map(Number));
  const len = Math.max(aVersions.length, bVersions.length);
  for (let i = 0; i < len; i++) {
    const av = aVersions[i] ?? [];
    const bv = bVersions[i] ?? [];
    const partLen = Math.max(av.length, bv.length);
    for (let j = 0; j < partLen; j++) {
      const cmp = (bv[j] ?? 0) - (av[j] ?? 0);
      if (cmp !== 0) return cmp;
    }
  }
  return a.name.localeCompare(b.name);
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

export function ModelSelect() {
  const { data: rawData, isLoading } = useProviders();
  const { contains } = useFilter({ sensitivity: "base" });
  const { isMobile } = useMediaQuery();

  const selectedModel = useModelStore((s) => s.selectedModel);
  const setModelFromKey = useModelStore((s) => s.setModelFromKey);
  const setModelFromDefault = useModelStore((s) => s.setModelFromDefault);
  const resetToDefault = useModelStore((s) => s.resetToDefault);
  const isOverridingDefault = useModelStore((s) => s.isOverridingDefault);

  const data = useMemo(
    () => (rawData ? transformProviders(rawData) : null),
    [rawData],
  );
  const providers = data?.providers ?? [];
  const defaultModel = data?.defaultModel ?? null;
  const defaultModelName = data?.defaultModelName ?? null;
  const selectedModelKey = `${selectedModel.providerID}/${selectedModel.modelID}`;
  const overriding = isOverridingDefault();

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
      selectedKey={overriding ? selectedModelKey : USE_DEFAULT_KEY}
      onSelectionChange={(key) => {
        if (!key) return;
        if (String(key) === USE_DEFAULT_KEY) {
          resetToDefault();
          return;
        }
        setModelFromKey(String(key));
      }}
    >
      <SelectTrigger className="w-full min-w-0 text-xs sm:text-sm" />
      <Popover className="entering:fade-in exiting:fade-out flex max-h-[min(80vh,32rem)] w-(--trigger-width) entering:animate-in exiting:animate-out flex-col overflow-hidden rounded-lg border bg-overlay">
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
              {defaultModel && (
                <SelectItem
                  id={USE_DEFAULT_KEY}
                  textValue={`Default${defaultModelName ? ` ${defaultModelName}` : ""}`}
                  className="font-medium"
                >
                  Default{defaultModelName ? ` — ${defaultModelName}` : ""}
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
                      {model.name}
                      {model.id === defaultModel && (
                        <span className="ml-1 text-muted-fg">(default)</span>
                      )}
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
