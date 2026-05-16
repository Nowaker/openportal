import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AccentSelector } from "@/components/accent-selector";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { ToolsSettings } from "@/components/tools-settings";
import { useTheme } from "@/providers/theme-provider";
import { useBreadcrumb } from "@/contexts/breadcrumb-context";
import {
  SwatchIcon,
  InformationCircleIcon,
  PencilSquareIcon,
  ShieldCheckIcon,
  TrashIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftRightIcon,
  BoltIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Loader } from "@/components/ui/loader";
import { toast } from "@/components/ui/toast";
import {
  useAutoApproveConfig,
  setAutoApproveDefault,
  removeSessionOverride,
  clearAllOverrides,
} from "@/stores/auto-approve-store";
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
  useUpdateStrategyStore,
  type UpdateStrategy,
} from "@/stores/update-strategy-store";
import {
  useSttModeStore,
  type SttMode,
  type SttBackend,
} from "@/stores/stt-mode-store";
import { useMarkdownModeStore } from "@/stores/markdown-mode-store";
import {
  useChatLinkStore,
  type ChatLinkBehavior,
} from "@/stores/chat-link-store";
import {
  useChatDisplayStore,
  ALL_ICONS,
  ICON_LABELS,
  type ChatIconId,
  type ChatPlatform,
} from "@/stores/chat-display-store";
import {
  useInstanceSettings,
  setToolOutputMaxBytes,
} from "@/stores/instance-settings-store";
import { Input } from "@/components/ui/input";
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

  const localePreview = React.useMemo(() => {
    if (typeof Intl === "undefined") return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(2025, 0, 1, 14, 23));
    } catch {
      return "";
    }
  }, []);

  return (
    <Select
      aria-label="Date and time format"
      selectedKey={format}
      onSelectionChange={(key) => {
        if (key === "locale" || key === "12h" || key === "24h") setFormat(key);
      }}
    >
      <SelectTrigger className="max-w-sm" />
      <SelectContent>
        <SelectItem id="locale" textValue={`Browser default (${localePreview})`}>
          <SelectLabel>
            Browser default
            {localePreview && (
              <span className="ml-1 text-muted-fg">({localePreview})</span>
            )}
          </SelectLabel>
        </SelectItem>
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

const chatLinkOptions: {
  id: ChatLinkBehavior;
  title: string;
  description: string;
}[] = [
  {
    id: "new-tab",
    title: "Open in a new tab",
    description:
      "Default. The chat scroll position is preserved; the link opens in a background tab.",
  },
  {
    id: "new-window",
    title: "Open in a new window",
    description:
      "Pop the link out into a separate browser window via window.open. Useful for side-by-side reading on desktop.",
  },
  {
    id: "this-tab",
    title: "Replace this tab",
    description:
      "Navigate the chat tab itself. The user has to come back to return to the conversation. Some keyboard-driven readers prefer this.",
  },
  {
    id: "none",
    title: "Do not link (inert text)",
    description:
      "URLs in chat are rendered as plain text. No clickable anchors, no accidental taps on mobile.",
  },
];

function ChatLinkBehaviorSetting() {
  const behavior = useChatLinkStore((s) => s.behavior);
  const setBehavior = useChatLinkStore((s) => s.setBehavior);

  return (
    <Select
      aria-label="Chat link opening behavior"
      selectedKey={behavior}
      onSelectionChange={(key) => {
        if (!key) return;
        setBehavior(String(key) as ChatLinkBehavior);
      }}
    >
      <SelectTrigger className="max-w-sm" />
      <SelectContent>
        {chatLinkOptions.map((opt) => (
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
  );
}

function ChatIconVisibilityGrid() {
  const iconVisibility = useChatDisplayStore((s) => s.iconVisibility);
  const setIconVisibility = useChatDisplayStore((s) => s.setIconVisibility);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr className="text-muted-fg">
              <th className="pr-3 pb-1 text-left font-medium">Icon</th>
              <th className="px-3 pb-1 text-center font-medium">Desktop</th>
              <th className="px-3 pb-1 text-center font-medium">Mobile</th>
            </tr>
          </thead>
          <tbody>
            {ALL_ICONS.map((icon) => (
              <tr key={icon} className="border-t border-border/40">
                <td className="pr-3 py-1.5 text-fg">{ICON_LABELS[icon]}</td>
                {(["desktop", "mobile"] as ChatPlatform[]).map((platform) => (
                  <td
                    key={platform}
                    className="px-3 py-1.5 text-center align-middle"
                  >
                    <Checkbox
                      isSelected={iconVisibility[platform][icon]}
                      onChange={(v) => setIconVisibility(platform, icon, v)}
                      aria-label={`${ICON_LABELS[icon]} on ${platform}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HoverInfoSetting() {
  const enabled = useChatDisplayStore((s) => s.hoverInfoEnabled);
  const setEnabled = useChatDisplayStore((s) => s.setHoverInfoEnabled);

  return (
    <Checkbox isSelected={enabled} onChange={setEnabled}>
      Show mode, model, and thinking effort on message hover (desktop)
    </Checkbox>
  );
}

function ShowInfoIconSetting() {
  const showInfoIcon = useChatDisplayStore((s) => s.showInfoIcon);
  const setShowInfoIcon = useChatDisplayStore((s) => s.setShowInfoIcon);

  return (
    <Checkbox isSelected={showInfoIcon} onChange={setShowInfoIcon}>
      Show separate (i) info icon (full metadata modal) alongside the
      expand icon (inline expansion)
    </Checkbox>
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

function AgentSettings() {
  const { data, isLoading } = useAgents();
  const agents = (data ?? []) as Agent[];

  const instance = useInstanceStore((s) => s.instance);
  const instanceId = instance?.id ?? null;

  const defaultAgentName = useAgentStore((s) => s.defaultAgentName);
  const setDefaultAgentName = useAgentStore((s) => s.setDefaultAgentName);
  const lastUsedAgentGlobal = useAgentStore((s) => s.lastUsedAgentGlobal);
  const setLastUsedAgentGlobal = useAgentStore((s) => s.setLastUsedAgentGlobal);
  const lastUsedAgentForInstance = useAgentStore((s) =>
    s.getLastUsedAgentForInstance(instanceId),
  );
  const setLastUsedAgentForInstance = useAgentStore((s) => s.setLastUsedAgentForInstance);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Default agent</h3>
        <p className="text-xs text-muted-fg">
          Choose how Portal picks the agent for a new session. New sessions resolve in this order: this server &rarr; any server &rarr; default.
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">Default for this server</p>
          <Select
            selectedKey={lastUsedAgentForInstance ?? "none"}
            onSelectionChange={(key) => {
              if (key) setLastUsedAgentForInstance(instanceId, String(key) === "none" ? null : String(key));
            }}
            placeholder={isLoading ? "Loading agents..." : "Select an agent"}
            aria-label="Default for this server"
          >
            <SelectTrigger className="max-w-sm" />
            <SelectContent>
              <SelectItem id="none" textValue="None (inherit global)">
                None (inherit global)
              </SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.name} id={agent.name} textValue={agent.name}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Default across all servers</p>
          <Select
            selectedKey={lastUsedAgentGlobal ?? "none"}
            onSelectionChange={(key) => {
              if (key) setLastUsedAgentGlobal(String(key) === "none" ? null : String(key));
            }}
            placeholder={isLoading ? "Loading agents..." : "Select an agent"}
            aria-label="Default across all servers"
          >
            <SelectTrigger className="max-w-sm" />
            <SelectContent>
              <SelectItem id="none" textValue="None (inherit default)">
                None (inherit default)
              </SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.name} id={agent.name} textValue={agent.name}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Default agent</p>
          <Select
            selectedKey={defaultAgentName}
            onSelectionChange={(key) => {
              if (key) setDefaultAgentName(String(key));
            }}
            placeholder={isLoading ? "Loading agents..." : "Select an agent"}
            aria-label="Default agent"
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

const updateStrategyOptions: {
  id: UpdateStrategy;
  title: string;
  description: string;
}[] = [
  {
    id: "polling",
    title: "Polling",
    description:
      "Timer refresh every 3 seconds. No live event bus. Lightest possible network and battery footprint; UI catches up at the next tick.",
  },
  {
    id: "snapshot",
    title: "Streaming - snapshot",
    description:
      "Persistent SSE event bus, but message rerenders only when OpenCode emits a full snapshot (message create + finalize). Activity indicators (status, questions, permissions) still update instantly.",
  },
  {
    id: "chunked",
    title: "Streaming - chunked (mobile default)",
    description:
      "Same as snapshot, plus per-token chunks throttled to 250ms windows per session. Smooth growing text without redrawing the prose hundreds of times per second.",
  },
  {
    id: "asap",
    title: "Streaming - ASAP (desktop default)",
    description:
      "Every event invalidates the cache immediately. Lowest possible latency between OpenCode emitting a token and the UI showing it. Resource intensive; not recommended on mobile.",
  },
];

const sttModeOptions: { id: SttMode; title: string; description: string }[] = [
  {
    id: "off",
    title: "Off",
    description: "No microphone button. Type prompts only.",
  },
  {
    id: "push-to-talk",
    title: "Push-to-talk",
    description:
      "Mic button visible. Tap to start recording, tap again to stop \u2014 the transcript is appended to the composer and the message is auto-submitted.",
  },
  {
    id: "vad",
    title: "Hands-free (VAD)",
    description:
      "Mic button visible. Tap to toggle continuous listening; the browser detects speech segments and transcribes each one to the composer.",
  },
];

const sttBackendOptions: {
  id: SttBackend;
  title: string;
  description: string;
}[] = [
  {
    id: "web-speech",
    title: "Browser (Web Speech API)",
    description:
      "Uses the browser's built-in SpeechRecognition. Free, instant, works on Android Chrome. Some browsers route audio through cloud services; check your platform's privacy policy.",
  },
  {
    id: "whisper-sidecar",
    title: "Whisper sidecar (self-hosted)",
    description:
      "POSTs audio to the @openportal/voice-stt sidecar, which runs whisper.cpp on your own machine. Fully self-hosted; no audio leaves your network.",
  },
];

function MarkdownSetting() {
  const chat = useMarkdownModeStore((s) => s.chat);
  const setChat = useMarkdownModeStore((s) => s.setChat);
  const pluginReadme = useMarkdownModeStore((s) => s.pluginReadme);
  const setPluginReadme = useMarkdownModeStore((s) => s.setPluginReadme);
  const options = [
    {
      id: "default",
      title: "Default",
      description:
        "GitHub-flavored markdown only. HTML in source is escaped. Safer for arbitrary text.",
    },
    {
      id: "extended",
      title: "Extended",
      description:
        "Adds HTML pass-through, GitHub > [!TIP]/[!NOTE]/[!WARNING] callouts, and rewrites relative image/link URLs against the source repository.",
    },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Markdown rendering</h3>
        <p className="text-xs text-muted-fg">
          Two surfaces, two preferences. Extended renders raw HTML from the
          markdown source - safe for plugin READMEs (you ran their code
          already), riskier for AI chat output.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Plugin README</p>
        <Select
          aria-label="Plugin README markdown mode"
          selectedKey={pluginReadme}
          onSelectionChange={(key) => {
            if (!key) return;
            setPluginReadme(String(key) as "default" | "extended");
          }}
        >
          <SelectTrigger className="max-w-sm" />
          <SelectContent>
            {options.map((opt) => (
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

      <div className="space-y-2">
        <p className="text-sm font-medium">AI chat</p>
        <Select
          aria-label="AI chat markdown mode"
          selectedKey={chat}
          onSelectionChange={(key) => {
            if (!key) return;
            setChat(String(key) as "default" | "extended");
          }}
        >
          <SelectTrigger className="max-w-sm" />
          <SelectContent>
            {options.map((opt) => (
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

function VoiceInputSetting() {
  const mode = useSttModeStore((s) => s.mode);
  const setMode = useSttModeStore((s) => s.setMode);
  const backend = useSttModeStore((s) => s.backend);
  const setBackend = useSttModeStore((s) => s.setBackend);
  const sidecarUrl = useSttModeStore((s) => s.sidecarUrl);
  const setSidecarUrl = useSttModeStore((s) => s.setSidecarUrl);
  const endOfStreamTimeoutMs = useSttModeStore((s) => s.endOfStreamTimeoutMs);
  const setEndOfStreamTimeoutMs = useSttModeStore((s) => s.setEndOfStreamTimeoutMs);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Voice input</h3>
        <p className="text-xs text-muted-fg">
          Speech-to-text for prompts. This preference is per-tab/per-device
          (localStorage), not synced.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Mode</p>
        <Select
          aria-label="Voice input mode"
          selectedKey={mode}
          onSelectionChange={(key) => {
            if (!key) return;
            setMode(String(key) as SttMode);
          }}
        >
          <SelectTrigger className="max-w-sm" />
          <SelectContent>
            {sttModeOptions.map((opt) => (
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

      {mode !== "off" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Backend</p>
          <Select
            aria-label="Voice input backend"
            selectedKey={backend}
            onSelectionChange={(key) => {
              if (!key) return;
              setBackend(String(key) as SttBackend);
            }}
          >
            <SelectTrigger className="max-w-sm" />
            <SelectContent>
              {sttBackendOptions.map((opt) => (
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
      )}

      {mode !== "off" && backend === "whisper-sidecar" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Sidecar URL</p>
          <Input
            value={sidecarUrl}
            onChange={(e) => setSidecarUrl(e.target.value)}
            placeholder="http://127.0.0.1:4150"
            className="max-w-sm"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
          />
          <p className="text-xs text-muted-fg">
            Where the @openportal/voice-stt service is listening. POST audio is
            sent to <code>{`${sidecarUrl.replace(/\/+$/, "")}/transcribe`}</code>.
          </p>
        </div>
      )}

      {mode === "push-to-talk" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">End of stream timeout (ms)</p>
          <Input
            type="number"
            value={endOfStreamTimeoutMs}
            onChange={(e) => setEndOfStreamTimeoutMs(parseInt(e.target.value, 10) || 0)}
            className="max-w-sm"
            min={0}
            step={100}
          />
          <p className="text-xs text-muted-fg">
            How long to wait after you stop talking before automatically submitting the prompt.
          </p>
        </div>
      )}
    </div>
  );
}

function ToolOutputCapSetting() {
  const { settings, isLoading } = useInstanceSettings();
  const current = settings.toolOutputMaxBytes;
  const [draftKb, setDraftKb] = React.useState<string>(() =>
    current === null ? "" : String(Math.round(current / 1024)),
  );
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setDraftKb(current === null ? "" : String(Math.round(current / 1024)));
  }, [current]);

  const handleSave = async () => {
    setBusy(true);
    try {
      const trimmed = draftKb.trim();
      if (trimmed === "") {
        await setToolOutputMaxBytes(null);
      } else {
        const kb = Number(trimmed);
        if (!Number.isFinite(kb) || kb <= 0) {
          toast.error("Enter a positive integer (KB), or leave blank to disable.");
          setBusy(false);
          return;
        }
        await setToolOutputMaxBytes(Math.floor(kb * 1024));
      }
    } catch {
      toast.error("Failed to update tool output cap");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Tool output byte cap</h3>
      <p className="text-xs text-muted-fg">
        How much tool output (kilobytes) OpenPortal sends to your browser
        per tool call. Large outputs (e.g. <code>find</code>,{" "}
        <code>grep</code> across a giant repo) are truncated server-side so
        the chat does not stall while your phone re-renders megabytes.
        Leave blank for no cap (forwards full output). Applies to every
        session on this OpenPortal instance.
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          placeholder="No cap"
          value={draftKb}
          onChange={(e) => setDraftKb(e.target.value)}
          className="max-w-[10rem]"
          isDisabled={isLoading || busy}
          aria-label="Tool output cap in kilobytes"
        />
        <span className="text-xs text-muted-fg">KB</span>
        <Button
          size="sm"
          onPress={() => {
            void handleSave();
          }}
          isDisabled={
            isLoading ||
            busy ||
            draftKb ===
              (current === null ? "" : String(Math.round(current / 1024)))
          }
        >
          {busy ? <Loader className="size-4" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}

function LiveUpdatesSetting() {
  const desktop = useUpdateStrategyStore((s) => s.desktop);
  const mobile = useUpdateStrategyStore((s) => s.mobile);
  const setDesktop = useUpdateStrategyStore((s) => s.setDesktop);
  const setMobile = useUpdateStrategyStore((s) => s.setMobile);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Live updates</h3>
        <p className="text-xs text-muted-fg">
          How OpenPortal stays in sync with OpenCode while a session runs. Each
          platform has its own strategy because mobile devices benefit from
          throttling whereas desktops generally don't. Preferences are per-
          device (localStorage), not synced across machines.
        </p>
      </div>

      <UpdateStrategyPicker
        label="On desktop"
        value={desktop}
        onChange={setDesktop}
      />
      <UpdateStrategyPicker
        label="On mobile"
        value={mobile}
        onChange={setMobile}
      />
    </div>
  );
}

function UpdateStrategyPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: UpdateStrategy;
  onChange: (s: UpdateStrategy) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <Select
        aria-label={`Update strategy ${label}`}
        selectedKey={value}
        onSelectionChange={(key) => {
          if (!key) return;
          onChange(String(key) as UpdateStrategy);
        }}
      >
        <SelectTrigger className="max-w-sm" />
        <SelectContent>
          {updateStrategyOptions.map((opt) => (
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
  );
}

function ComposerSettings() {
  const enterKeyAction = useComposerStore((s) => s.enterKeyAction);
  const setEnterKeyAction = useComposerStore((s) => s.setEnterKeyAction);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Enter key behaviour</h3>
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

function PermissionsSettings() {
  const { config, isLoading } = useAutoApproveConfig();
  const [pendingRemove, setPendingRemove] = React.useState<string | null>(null);
  const [busyDefault, setBusyDefault] = React.useState(false);
  const [confirmClearAll, setConfirmClearAll] = React.useState(false);
  const [clearBusy, setClearBusy] = React.useState(false);

  const overrideEntries = React.useMemo(() => {
    return Object.entries(config.sessionOverrides).sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [config.sessionOverrides]);

  const handleDefaultChange = async (value: boolean) => {
    setBusyDefault(true);
    try {
      await setAutoApproveDefault(value);
    } catch {
      toast.error("Failed to update global default");
    } finally {
      setBusyDefault(false);
    }
  };

  const handleRemoveOne = async (sessionId: string) => {
    setPendingRemove(sessionId);
    try {
      await removeSessionOverride(sessionId);
    } catch {
      toast.error("Failed to remove override");
    } finally {
      setPendingRemove(null);
    }
  };

  const handleClearAll = async () => {
    setClearBusy(true);
    try {
      await clearAllOverrides();
      setConfirmClearAll(false);
    } catch {
      toast.error("Failed to clear overrides");
    } finally {
      setClearBusy(false);
    }
  };

  return (
    <div className="space-y-10">
      <div>
        <h3 className="text-sm font-semibold">Permissions</h3>
        <p className="text-xs text-muted-fg">
          Auto-approve permission requests so the agent doesn&#39;t wait for a
          manual reply. The OpenPortal server holds an SSE connection to
          every configured OpenCode instance and fires replies independently
          of any browser tab being open. Every auto-fired reply is recorded
          in the chat audit trail with an &quot;auto&quot; badge.
        </p>
      </div>

      <section className="space-y-3">
        <div>
          <h4 className="text-sm font-medium">Global default</h4>
          <p className="text-xs text-muted-fg">
            Applied to every session that has no override below. The composer
            shield toggle in each chat sets an override for that session.
          </p>
        </div>
        <Checkbox
          isSelected={config.globalDefault}
          isDisabled={isLoading || busyDefault}
          onChange={(value) => {
            void handleDefaultChange(value);
          }}
        >
          Auto-approve permissions by default
        </Checkbox>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-medium">Per-session overrides</h4>
            <p className="text-xs text-muted-fg">
              Sessions where the shield toggle differs from the global
              default. Remove to fall back to the default.
            </p>
          </div>
          {overrideEntries.length > 0 && (
            <Button
              intent="danger"
              size="sm"
              onPress={() => setConfirmClearAll(true)}
              isDisabled={clearBusy}
            >
              <TrashIcon className="size-4" data-slot="icon" />
              Remove all
            </Button>
          )}
        </div>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader className="size-5" />
          </div>
        ) : overrideEntries.length === 0 ? (
          <p className="text-xs text-muted-fg italic">
            No overrides. All sessions follow the global default above.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {overrideEntries.map(([sid, value]) => (
              <li
                key={sid}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="font-mono text-xs truncate">{sid}</div>
                  <div className="text-xs text-muted-fg">
                    Auto-approve:{" "}
                    <span
                      className={
                        value
                          ? "font-medium text-accent"
                          : "font-medium text-muted-fg"
                      }
                    >
                      {value ? "ON" : "OFF"}
                    </span>
                  </div>
                </div>
                <Button
                  intent="secondary"
                  size="sm"
                  isDisabled={pendingRemove === sid}
                  onPress={() => {
                    void handleRemoveOne(sid);
                  }}
                  aria-label={`Remove override for ${sid}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        isOpen={confirmClearAll}
        title="Remove all session overrides?"
        description={`All ${overrideEntries.length} session override${
          overrideEntries.length === 1 ? "" : "s"
        } will be removed; those sessions will follow the global default (${
          config.globalDefault ? "ON" : "OFF"
        }).`}
        confirmLabel="Remove all"
        tone="danger"
        busy={clearBusy}
        onConfirm={handleClearAll}
        onClose={() => {
          if (!clearBusy) setConfirmClearAll(false);
        }}
      />
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
    return [
      "appearance",
      "prompt",
      "composer",
      "chat",
      "tools",
      "performance",
      "diagnostics",
    ].includes(hash)
      ? hash
      : "appearance";
  });

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      setSettingsTabState(
        [
          "appearance",
          "prompt",
          "composer",
          "chat",
          "tools",
          "performance",
          "diagnostics",
        ].includes(hash)
          ? hash
          : "appearance",
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
      <div className="container mx-auto space-y-8 px-4 py-6">
      <Tabs
        aria-label="Settings"
        className="overflow-x-hidden"
        selectedKey={settingsTab}
        onSelectionChange={(key) => setSettingsTab(String(key))}
      >
        <TabList className="flex overflow-x-auto scrollbar-none !border-b-0 [&_*[data-slot=selected-indicator]]:hidden">
          <Tab id="appearance">
            <SwatchIcon className="size-4" data-slot="icon" />
            Appearance
          </Tab>
          <Tab id="prompt">
            <PencilSquareIcon className="size-4" data-slot="icon" />
            Prompt
          </Tab>
          <Tab id="composer">
            <ChatBubbleLeftEllipsisIcon className="size-4" data-slot="icon" />
            Composer
          </Tab>
          <Tab id="chat">
            <ChatBubbleLeftRightIcon className="size-4" data-slot="icon" />
            Chat
          </Tab>
          <Tab id="tools">
            <WrenchScrewdriverIcon className="size-4" data-slot="icon" />
            Tools
          </Tab>
          <Tab id="performance">
            <BoltIcon className="size-4" data-slot="icon" />
            Performance
          </Tab>
          <Tab id="diagnostics">
            <InformationCircleIcon className="size-4" data-slot="icon" />
            Diagnostics
          </Tab>
        </TabList>

        <TabPanel id="appearance" className="pt-6">
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Appearance</h2>
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
            </div>
          </div>
        </TabPanel>

        <TabPanel id="prompt" className="pt-6">
          <div className="space-y-10">
            <div>
              <h2 className="text-lg font-semibold">Prompt</h2>
            </div>

            <section className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold">Default model</h3>
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
              <VoiceInputSetting />
            </section>
          </div>
        </TabPanel>

        <TabPanel id="composer" className="pt-6">
          <div className="space-y-10">
            <div>
              <h2 className="text-lg font-semibold">Chat</h2>
            </div>

            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">Date and time format</h3>
                <p className="text-xs text-muted-fg">
                  Display format for chat message timestamps. Date prefix
                  (e.g. <code>4/3</code>) is added when the message is from
                  a previous day; the year is added when it&#39;s from a
                  previous year.
                </p>
              </div>
              <DateFormatSetting />
            </section>

            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">Link opening behavior</h3>
                <p className="text-xs text-muted-fg">
                  What happens when you click a link inside an AI response.
                </p>
              </div>
              <ChatLinkBehaviorSetting />
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Per-icon visibility</h3>
                <p className="text-xs text-muted-fg">
                  Hide individual chat row icons on the platforms where they
                  feel cluttered. Wire-up against MessageBubble + ToolCallItem
                  pending - the store ships first so preferences survive the
                  next build cycle.
                </p>
              </div>
              <ChatIconVisibilityGrid />
            </section>

            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">Hover info</h3>
                <p className="text-xs text-muted-fg">
                  On desktop, hovering a message reveals the mode, model, and
                  thinking-effort the assistant used. Disable to keep the row
                  perfectly stable on mouse-over.
                </p>
              </div>
              <HoverInfoSetting />
            </section>

            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">Info icon</h3>
                <p className="text-xs text-muted-fg">
                  The expand icon stays inline-expand-only. Turning this on
                  adds a separate (i) icon that opens a modal with the full
                  OpenCode message metadata (id, parts, raw event payload).
                </p>
              </div>
              <ShowInfoIconSetting />
            </section>

            <section>
              <MarkdownSetting />
            </section>
          </div>
        </TabPanel>

        <TabPanel id="tools" className="pt-6">
          <div className="space-y-10">
            <div>
              <h2 className="text-lg font-semibold">Tools</h2>
            </div>
            <ToolsSettings />
          </div>
        </TabPanel>

        <TabPanel id="performance" className="pt-6">
          <div className="space-y-10">
            <div>
              <h2 className="text-lg font-semibold">Performance</h2>
            </div>
            <LiveUpdatesSetting />
            <ToolOutputCapSetting />
          </div>
        </TabPanel>

        <TabPanel id="diagnostics" className="pt-6">
          <DiagnosticsPanel />
        </TabPanel>
      </Tabs>
      </div>
    </div>
  );
}
