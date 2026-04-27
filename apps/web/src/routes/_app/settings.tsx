import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AccentSelector } from "@/components/accent-selector";
import { useTheme } from "@/providers/theme-provider";
import { useBreadcrumb } from "@/contexts/breadcrumb-context";
import {
  SwatchIcon,
  CpuChipIcon,
  KeyIcon,
  CommandLineIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSection,
  SelectTrigger,
} from "@/components/ui/select";
import { Tabs, TabList, Tab, TabPanel } from "@/components/ui/tabs";
import { useAgents, useProviders } from "@/hooks/use-opencode";
import { useAgentStore } from "@/stores/agent-store";
import { useComposerStore, type EnterKeyAction } from "@/stores/composer-store";
import {
  FONT_SIZE_PRESETS,
  useFontSizeStore,
  type FontSizeScale,
} from "@/stores/font-size-store";
import { useModelStore } from "@/stores/model-store";
import { compareModels } from "@/lib/model-sort";
import type { Agent } from "@opencode-ai/sdk";

const themes = [
  { id: "light", title: "Light" },
  { id: "dark", title: "Dark" },
  { id: "system", title: "System" },
];

function ThemeSetting() {
  const { theme, setTheme } = useTheme();

  return (
    <Select
      value={theme}
      onChange={(value) =>
        value && setTheme(value as "light" | "dark" | "system")
      }
      placeholder="Select theme"
    >
      <SelectTrigger className="max-w-sm" />
      <SelectContent>
        {themes.map((item) => (
          <SelectItem key={item.id} id={item.id} textValue={item.title}>
            {item.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FontSizeSetting() {
  const scale = useFontSizeStore((s) => s.scale);
  const setScale = useFontSizeStore((s) => s.setScale);
  const selected = String(scale);

  return (
    <Select
      aria-label="Font size"
      selectedKey={selected}
      onSelectionChange={(key) => {
        if (!key) return;
        const next = Number(key) as FontSizeScale;
        if (FONT_SIZE_PRESETS.includes(next)) setScale(next);
      }}
    >
      <SelectTrigger className="max-w-sm" />
      <SelectContent>
        {FONT_SIZE_PRESETS.map((value) => {
          const id = String(value);
          const pct = Math.round(value * 100);
          const isDefault = value === 1;
          return (
            <SelectItem
              key={id}
              id={id}
              textValue={`${pct}%${isDefault ? " (default)" : ""}`}
            >
              {pct}%
              {isDefault && (
                <span className="ml-1 text-muted-fg">(default)</span>
              )}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

interface ModelListItem {
  id: string;
  name: string;
}

interface SettingsProvider {
  id: string;
  name: string;
  models: ModelListItem[];
}

interface RawProvider {
  id: string;
  name: string;
  models?: Record<string, { id: string; name: string }>;
}

function buildProviderList(
  raw: { providers?: RawProvider[]; default?: Record<string, string> } | null,
): { providers: SettingsProvider[]; defaultKey: string | null } {
  if (!raw) return { providers: [], defaultKey: null };

  const defaults = raw.default ?? {};
  let defaultKey: string | null = null;
  for (const [providerId, modelId] of Object.entries(defaults)) {
    if (modelId) {
      defaultKey = `${providerId}/${modelId}`;
      break;
    }
  }

  const providers: SettingsProvider[] = (raw.providers ?? [])
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      models: Object.values(provider.models ?? {})
        .map((m) => ({ id: `${provider.id}/${m.id}`, name: m.name }))
        .sort(compareModels),
    }))
    .filter((p) => p.models.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { providers, defaultKey };
}

const fonts = [
  { id: "inter", title: "Inter" },
  { id: "geist-sans", title: "Geist Sans" },
  { id: "geist-mono", title: "Geist Mono" },
  { id: "system", title: "System Default" },
];

const STRATEGIES = [
  {
    id: "specific" as const,
    title: "Always use a specific agent",
  },
  {
    id: "last-used" as const,
    title: "Last used in any session (with fallback)",
  },
];

function AgentSettings() {
  const { data, isLoading } = useAgents();
  const agents = (data ?? []) as Agent[];

  const defaultAgentStrategy = useAgentStore((s) => s.defaultAgentStrategy);
  const defaultAgentName = useAgentStore((s) => s.defaultAgentName);
  const setDefaultAgentStrategy = useAgentStore(
    (s) => s.setDefaultAgentStrategy,
  );
  const setDefaultAgentName = useAgentStore((s) => s.setDefaultAgentName);
  const lastUsedAgent = useAgentStore((s) => s.lastUsedAgentGlobal);

  const fallbackLabel =
    defaultAgentStrategy === "specific" ? "Default agent" : "Fallback agent";
  const fallbackHelp =
    defaultAgentStrategy === "specific"
      ? "New sessions will start with this agent selected."
      : "Used when no last-used agent is recorded yet, or when it no longer exists.";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Agent</h2>
        <p className="text-sm text-muted-fg">
          Choose how Portal picks the agent for a new session.
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">Default agent strategy</p>
          <p className="text-xs text-muted-fg">
            Whether new sessions inherit your last choice or always start from
            a fixed agent.
          </p>
          <Select
            selectedKey={defaultAgentStrategy}
            onSelectionChange={(key) => {
              if (key) setDefaultAgentStrategy(String(key) as never);
            }}
            placeholder="Select a strategy"
            aria-label="Default agent strategy"
          >
            <SelectTrigger className="max-w-sm" />
            <SelectContent>
              {STRATEGIES.map((item) => (
                <SelectItem key={item.id} id={item.id} textValue={item.title}>
                  {item.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{fallbackLabel}</p>
          <p className="text-xs text-muted-fg">{fallbackHelp}</p>
          <Select
            selectedKey={defaultAgentName}
            onSelectionChange={(key) => {
              if (key) setDefaultAgentName(String(key));
            }}
            placeholder={isLoading ? "Loading agents..." : "Select an agent"}
            aria-label={fallbackLabel}
          >
            <SelectTrigger className="max-w-sm" />
            <SelectContent items={agents}>
              {(agent) => (
                <SelectItem id={agent.name} textValue={agent.name}>
                  {agent.name}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {defaultAgentStrategy === "last-used" && (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-fg">
            {lastUsedAgent
              ? `Currently last used: ${lastUsedAgent}`
              : "No agent has been used yet — the fallback will be applied."}
          </div>
        )}
      </div>
    </div>
  );
}

const enterKeyOptions: { id: EnterKeyAction; title: string; hint: string }[] = [
  {
    id: "submit",
    title: "Send the message",
    hint: "Shift+Enter inserts a newline",
  },
  {
    id: "newline",
    title: "Insert a newline",
    hint: "Shift+Enter or Cmd/Ctrl+Enter sends the message",
  },
];

function ComposerSettings() {
  const enterKeyAction = useComposerStore((s) => s.enterKeyAction);
  const setEnterKeyAction = useComposerStore((s) => s.setEnterKeyAction);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Composer</h2>
        <p className="text-sm text-muted-fg">
          Customize the message composer behaviour.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Enter key behaviour</p>
        <p className="text-xs text-muted-fg">
          What pressing Enter (without modifiers) does in the composer.
        </p>
        <Select
          aria-label="Enter key behaviour"
          selectedKey={enterKeyAction}
          onSelectionChange={(key) => {
            if (!key) return;
            setEnterKeyAction(String(key) as EnterKeyAction);
          }}
        >
          <SelectTrigger className="max-w-sm" />
          <SelectContent>
            {enterKeyOptions.map((opt) => (
              <SelectItem key={opt.id} id={opt.id} textValue={opt.title}>
                {opt.title}
                <span className="ml-1 text-muted-fg text-xs">— {opt.hint}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function SettingsPage() {
  const { fontFamily, setFontFamily } = useTheme();
  const { setPageTitle } = useBreadcrumb();
  const { data: rawProviders, isLoading: providersLoading } = useProviders();
  const selectedModel = useModelStore((s) => s.selectedModel);
  const setModelFromKey = useModelStore((s) => s.setModelFromKey);
  const setModelFromDefault = useModelStore((s) => s.setModelFromDefault);

  const { providers, defaultKey } = React.useMemo(
    () => buildProviderList(rawProviders ?? null),
    [rawProviders],
  );

  React.useEffect(() => {
    if (defaultKey) setModelFromDefault(defaultKey);
  }, [defaultKey, setModelFromDefault]);

  const selectedKey = `${selectedModel.providerID}/${selectedModel.modelID}`;

  React.useEffect(() => {
    setPageTitle("Settings");
    return () => setPageTitle(null);
  }, [setPageTitle]);

  return (
    <div className="container mx-auto space-y-8 px-4 py-10">
      <div className="space-y-2">
        <h1 className="bg-gradient-to-r from-fg to-muted-fg bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
          Settings
        </h1>
        <p className="text-lg text-muted-fg">
          Manage your interface preferences and configurations.
        </p>
      </div>

      <Tabs aria-label="Settings">
        <TabList>
          <Tab id="appearance">
            <SwatchIcon className="size-4" data-slot="icon" />
            Appearance
          </Tab>
          <Tab id="model">
            <CpuChipIcon className="size-4" data-slot="icon" />
            Model
          </Tab>
          <Tab id="agent">
            <CommandLineIcon className="size-4" data-slot="icon" />
            Agent
          </Tab>
          <Tab id="composer">
            <PencilSquareIcon className="size-4" data-slot="icon" />
            Composer
          </Tab>
          <Tab id="api">
            <KeyIcon className="size-4" data-slot="icon" />
            API
          </Tab>
        </TabList>

        <TabPanel id="appearance" className="pt-6">
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Appearance</h2>
              <p className="text-sm text-muted-fg">
                Customize the visual experience of the portal.
              </p>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <p className="text-sm font-medium">Accent Color</p>
                <p className="text-xs text-muted-fg">
                  Select a primary color for buttons and highlights.
                </p>
                <AccentSelector />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Theme Preference</p>
                <p className="text-xs text-muted-fg">
                  Switch between light, dark, or system modes.
                </p>
                <ThemeSetting />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Font Family</p>
                <p className="text-xs text-muted-fg">
                  Choose a typeface for the interface.
                </p>
                <Select
                  value={fontFamily}
                  onChange={(value) =>
                    setFontFamily(
                      value as "inter" | "geist-sans" | "geist-mono" | "system",
                    )
                  }
                  placeholder="Select a font"
                >
                  <SelectTrigger className="max-w-sm" />
                  <SelectContent>
                    {fonts.map((item) => (
                      <SelectItem
                        key={item.id}
                        id={item.id}
                        textValue={item.title}
                      >
                        {item.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Font Size</p>
                <p className="text-xs text-muted-fg">
                  Scale the entire interface up or down. 100% is the default.
                </p>
                <FontSizeSetting />
              </div>
            </div>
          </div>
        </TabPanel>

        <TabPanel id="model" className="pt-6">
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Model Configuration</h2>
              <p className="text-sm text-muted-fg">
                Select the AI model that powers your assistant.
              </p>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <p className="text-sm font-medium">Selected Model</p>
                <p className="text-xs text-muted-fg">
                  The model used for generating code and responses. The server
                  default is marked, and your selection is remembered locally.
                </p>
                <Select
                  aria-label="Selected model"
                  selectedKey={selectedKey}
                  onSelectionChange={(key) => {
                    if (!key) return;
                    setModelFromKey(String(key));
                  }}
                  placeholder={
                    providersLoading ? "Loading models..." : "Select a model"
                  }
                  isDisabled={providersLoading || providers.length === 0}
                >
                  <SelectTrigger className="max-w-sm" />
                  <SelectContent
                    className="max-h-[min(70vh,28rem)]"
                    popover={{
                      className:
                        "flex max-h-[min(80vh,32rem)] flex-col overflow-hidden",
                    }}
                  >
                    {providers.map((provider) => (
                      <SelectSection
                        key={provider.id}
                        title={provider.name}
                        items={provider.models}
                      >
                        {(model) => (
                          <SelectItem id={model.id} textValue={model.name}>
                            {model.name}
                            {model.id === defaultKey && (
                              <span className="ml-1 text-muted-fg">
                                (default)
                              </span>
                            )}
                          </SelectItem>
                        )}
                      </SelectSection>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Temperature</p>
                <p className="text-xs text-muted-fg">
                  Controls randomness in the model's output.
                </p>
                <div className="flex h-9 w-fit items-center rounded-lg border border-input px-3 text-sm text-muted-fg bg-muted/5">
                  0.7
                </div>
              </div>
            </div>
          </div>
        </TabPanel>

        <TabPanel id="agent" className="pt-6">
          <AgentSettings />
        </TabPanel>

        <TabPanel id="composer" className="pt-6">
          <ComposerSettings />
        </TabPanel>

        <TabPanel id="api" className="pt-6">
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">API Connections</h2>
              <p className="text-sm text-muted-fg">
                Manage your connection settings and API keys.
              </p>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <p className="text-sm font-medium">OpenCode Endpoint</p>
                <p className="text-xs text-muted-fg">
                  The URL of your OpenCode server instance.
                </p>
                <Input
                  defaultValue="http://localhost:4000"
                  readOnly
                  className="w-fit font-mono text-sm text-muted-fg bg-muted/5"
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">API Key</p>
                <p className="text-xs text-muted-fg">
                  Your API key is stored locally and never sent to our servers.
                </p>
                <Input
                  type="password"
                  value="sk-................................"
                  readOnly
                  className="w-fit font-mono text-sm text-muted-fg bg-muted/5"
                />
              </div>
            </div>
          </div>
        </TabPanel>
      </Tabs>
    </div>
  );
}
