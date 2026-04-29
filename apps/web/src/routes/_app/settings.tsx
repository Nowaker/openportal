import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AccentSelector } from "@/components/accent-selector";
import { ToolsSettings } from "@/components/tools-settings";
import { useTheme } from "@/providers/theme-provider";
import { useBreadcrumb } from "@/contexts/breadcrumb-context";
import {
  ArrowLeftIcon,
  SwatchIcon,
  KeyIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSection,
  SelectTrigger,
} from "@/components/ui/select";
import { Tabs, TabList, Tab, TabPanel } from "@/components/ui/tabs";
import { useAgents, useProviders } from "@/hooks/use-opencode";
import { useAgentStore } from "@/stores/agent-store";
import { useInstanceStore } from "@/stores/instance-store";
import { useComposerStore, type EnterKeyAction } from "@/stores/composer-store";
import {
  FONT_SIZE_PRESETS,
  useFontSizeStore,
  type FontSizeScale,
} from "@/stores/font-size-store";
import { useModelStore } from "@/stores/model-store";
import { useDateFormatStore } from "@/stores/date-format-store";
import { useThinkingStore } from "@/stores/thinking-store";
import {
  variantIcon,
  variantDisplayLabel,
} from "@/components/thinking-select";
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

function DefaultThinkingSetting() {
  const value = useThinkingStore((s) => s.defaultEffort);
  const setDefault = useThinkingStore((s) => s.setDefault);
  const options = ["", "low", "medium", "high", "max"];
  return (
    <Select
      aria-label="Default thinking effort"
      selectedKey={value || "default"}
      onSelectionChange={(key) => {
        if (!key) return;
        setDefault(String(key) === "default" ? "" : String(key));
      }}
    >
      <SelectTrigger className="max-w-sm" />
      <SelectContent>
        {options.map((v) => (
          <SelectItem
            key={v || "default"}
            id={v || "default"}
            textValue={variantDisplayLabel(v)}
          >
            <span className="flex items-center gap-2">
              {variantIcon(v, "size-4")}
              <SelectLabel>{variantDisplayLabel(v)}</SelectLabel>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DateFormatSetting() {
  const format = useDateFormatStore((s) => s.format);
  const setFormat = useDateFormatStore((s) => s.setFormat);

  return (
    <Select
      aria-label="Date and time format"
      selectedKey={format}
      onSelectionChange={(key) => {
        if (key === "12h" || key === "24h") setFormat(key);
      }}
    >
      <SelectTrigger className="max-w-sm" />
      <SelectContent>
        <SelectItem id="12h" textValue="12-hour (2:23pm)">
          <SelectLabel>
            12-hour <span className="ml-1 text-muted-fg">(2:23pm)</span>
          </SelectLabel>
        </SelectItem>
        <SelectItem id="24h" textValue="24-hour (14:23)">
          <SelectLabel>
            24-hour <span className="ml-1 text-muted-fg">(14:23)</span>
          </SelectLabel>
        </SelectItem>
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
              {/* SelectLabel reserves the tick column in the grid layout
                  used by SelectItem; without it, the row collapses to a
                  single column and the tick / text / muted suffix all pile
                  on top of each other. Same fix as ModelSelect. */}
              <SelectLabel>
                {pct}%
                {isDefault && (
                  <span className="ml-1 text-muted-fg">(default)</span>
                )}
              </SelectLabel>
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

  const instance = useInstanceStore((s) => s.instance);
  const instanceId = instance?.id ?? null;

  const defaultAgentStrategy = useAgentStore((s) => s.defaultAgentStrategy);
  const defaultAgentName = useAgentStore((s) => s.defaultAgentName);
  const setDefaultAgentStrategy = useAgentStore(
    (s) => s.setDefaultAgentStrategy,
  );
  const setDefaultAgentName = useAgentStore((s) => s.setDefaultAgentName);
  const lastUsedAgentGlobal = useAgentStore((s) => s.lastUsedAgentGlobal);
  const lastUsedAgentForInstance = useAgentStore((s) =>
    s.getLastUsedAgentForInstance(instanceId),
  );

  const fallbackLabel =
    defaultAgentStrategy === "specific" ? "Default agent" : "Fallback agent";
  const fallbackHelp =
    defaultAgentStrategy === "specific"
      ? "New sessions will start with this agent selected."
      : "When 'last used' resolves to nothing on this server or globally, this is the agent the new session falls back to.";

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
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-fg space-y-1">
            <div>
              <span className="font-medium">On this server: </span>
              {lastUsedAgentForInstance ?? (
                <span className="opacity-60">none yet</span>
              )}
            </div>
            <div>
              <span className="font-medium">Anywhere (global): </span>
              {lastUsedAgentGlobal ?? (
                <span className="opacity-60">none yet</span>
              )}
            </div>
            <div className="opacity-70 italic">
              New sessions resolve in this order:
              this server → any server → fallback above.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Only the bare-Enter behaviour is variable. Shift+Enter ALWAYS inserts a
// newline, Ctrl/Cmd+Enter ALWAYS submits, regardless of this setting. This
// preference also drives the soft-keyboard Enter on phones (the on-screen
// 'submit' arrow vs the newline arrow).
const enterKeyOptions: {
  id: EnterKeyAction;
  title: string;
  description: string;
}[] = [
  {
    id: "submit",
    title: "Send the message",
    description:
      "On mobile, the soft keyboard's Enter button submits the message instead of inserting a new line.",
  },
  {
    id: "newline",
    title: "Insert a new line",
    description:
      "On mobile, the soft keyboard's Enter button inserts a new line.",
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
          What unmodified Enter does in the composer.
          {" "}
          Shift+Enter always inserts a new line and Cmd/Ctrl+Enter always
          submits, regardless of this setting.
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
                <SelectLabel>{opt.title}</SelectLabel>
                <div
                  slot="description"
                  className="col-start-2 row-start-2 text-muted-fg text-[10px] leading-tight sm:text-xs"
                >
                  {opt.description}
                </div>
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
  const instance = useInstanceStore((s) => s.instance);
  const instanceId = instance?.id ?? null;
  // Settings is "set the default for this server". With the layered store,
  // Settings binds to the instance-scoped last-used pointer; it's not tied
  // to a session, so we pass sessionId=null and let resolution fall through
  // to instance / global / workspace default.
  const resolvedKey = useModelStore((s) =>
    s.resolveModelKey(null, instanceId),
  );
  const setInstanceDefaultModel = useModelStore(
    (s) => s.setInstanceDefaultModel,
  );
  const setModelFromDefault = useModelStore((s) => s.setModelFromDefault);

  const { providers, defaultKey } = React.useMemo(
    () => buildProviderList(rawProviders ?? null),
    [rawProviders],
  );

  React.useEffect(() => {
    if (defaultKey) setModelFromDefault(defaultKey);
  }, [defaultKey, setModelFromDefault]);

  const selectedKey = resolvedKey;

  React.useEffect(() => {
    setPageTitle("Settings");
    return () => setPageTitle(null);
  }, [setPageTitle]);

  // Active tab is reflected in the URL hash for deep-linking and reload
  // recovery, but tab-switching uses replaceState so the browser Back
  // button skips over tab changes and goes straight to the previous route
  // (i.e. the session the user came from).
  const [settingsTab, setSettingsTabState] = React.useState<string>(() => {
    if (typeof window === "undefined") return "appearance";
    const hash = window.location.hash.replace(/^#/, "");
    return ["appearance", "prompt", "api"].includes(hash) ? hash : "appearance";
  });

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      setSettingsTabState(
        ["appearance", "prompt", "api"].includes(hash) ? hash : "appearance",
      );
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  const setSettingsTab = React.useCallback((next: string) => {
    setSettingsTabState(next);
    if (typeof window !== "undefined") {
      const url = `${window.location.pathname}${window.location.search}#${next}`;
      window.history.replaceState(null, "", url);
    }
  }, []);

  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="container mx-auto space-y-8 px-4 py-10">
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                window.location.href = "/";
              }
            }}
            className="inline-flex items-center gap-1 text-sm text-muted-fg hover:text-fg transition-colors"
            aria-label="Back"
          >
            <ArrowLeftIcon className="size-4" />
            Back
          </button>
        <h1 className="bg-gradient-to-r from-fg to-muted-fg bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
          Settings
        </h1>
        <p className="text-lg text-muted-fg">
          Manage your interface preferences and configurations.
        </p>
      </div>

      <Tabs
        aria-label="Settings"
        className="overflow-x-hidden"
        selectedKey={settingsTab}
        onSelectionChange={(key) => setSettingsTab(String(key))}
      >
        <TabList className="flex overflow-x-auto scrollbar-none">
          <Tab id="appearance">
            <SwatchIcon className="size-4" data-slot="icon" />
            Appearance
          </Tab>
          <Tab id="prompt">
            <PencilSquareIcon className="size-4" data-slot="icon" />
            Prompt
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

              <div className="space-y-2">
                <p className="text-sm font-medium">Accent Color</p>
                <p className="text-xs text-muted-fg">
                  Primary color for buttons and highlights.
                </p>
                <AccentSelector />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Date and time format</p>
                <p className="text-xs text-muted-fg">
                  Display format for chat message timestamps. Date prefix
                  (e.g. <code>4/3</code>) is added when the message is from
                  a previous day.
                </p>
                <DateFormatSetting />
              </div>
            </div>
          </div>
        </TabPanel>

        <TabPanel id="prompt" className="pt-6">
          <div className="space-y-10">
            <div>
              <h2 className="text-lg font-semibold">Prompt</h2>
              <p className="text-sm text-muted-fg">
                Configure how you compose and dispatch prompts: the model and
                agent that handle them, and how the composer behaves.
              </p>
            </div>

            <section className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold">Model</h3>
                <p className="text-xs text-muted-fg">
                  The model used for generating code and responses. The server
                  default is marked, and your selection is remembered locally.
                </p>
              </div>
              <div className="space-y-2">
                <Select
                  aria-label="Selected model"
                  selectedKey={selectedKey}
                  onSelectionChange={(key) => {
                    if (!key) return;
                    setInstanceDefaultModel(String(key), instanceId);
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
                            <SelectLabel>
                              {model.name}
                              {model.id === defaultKey && (
                                <span className="ml-1 text-muted-fg">
                                  (default)
                                </span>
                              )}
                            </SelectLabel>
                          </SelectItem>
                        )}
                      </SelectSection>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">Default thinking effort</h3>
                <p className="text-xs text-muted-fg">
                  Reasoning budget for new sessions. Applied per request as
                  the model's variant; ignored when the chosen model doesn't
                  support that level.
                </p>
              </div>
              <DefaultThinkingSetting />
            </section>

            <section>
              <AgentSettings />
            </section>

            <section>
              <ComposerSettings />
            </section>

            <section>
              <ToolsSettings />
            </section>
          </div>
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
    </div>
  );
}
