import * as React from "react";
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AccentSelector } from "@/components/accent-selector";
import { ContentVisibilityTable } from "@/components/content-visibility-table";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { NotificationsSettings } from "@/components/notifications-settings";
import { StuckRecoverySettings } from "@/components/stuck-recovery-settings";
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
  BellIcon,
  EyeIcon,
  FolderIcon,
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
import { useAgents, useProviders, useSessions } from "@/hooks/use-opencode";
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
  useNotificationSoundStore,
  playNotificationSound,
  playSoundById,
  SOUND_OPTIONS,
  type NotificationCategory,
  type SoundId,
} from "@/stores/notification-sound-store";
import {
  useTtsStore,
  speakText,
  stopSpeaking,
} from "@/stores/tts-store";
import {
  useTitleBarActionsStore,
  SESSION_ACTIONS,
  type ActionPlacement,
  type SessionActionId,
} from "@/stores/title-bar-actions-store";
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
import { useFileBrowserSettingsStore } from "@/stores/file-browser-settings-store";
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


  const lastUsedAgentGlobal = useAgentStore((s) => s.lastUsedAgentGlobal);
  const setLastUsedAgentGlobal = useAgentStore((s) => s.setLastUsedAgentGlobal);
  const lastUsedAgentForInstance = useAgentStore((s) =>
    s.getLastUsedAgentForInstance(instanceId),
  );
  const setLastUsedAgentForInstance = useAgentStore((s) => s.setLastUsedAgentForInstance);

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">Default agent</h3>
        <p className="text-xs text-muted-fg">
          New sessions resolve in this order: this server &rarr; any server.
          Leave both unset to let OpenCode pick its own default.
        </p>
      </div>

      <div className="space-y-4">
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
              <SelectItem id="none" textValue="None">
                None (OpenCode picks)
              </SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.name} id={agent.name} textValue={agent.name}>
                  {agent.name}
                </SelectItem>
              ))}
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
  const autoSubmitOnEnd = useSttModeStore((s) => s.autoSubmitOnEnd);
  const setAutoSubmitOnEnd = useSttModeStore((s) => s.setAutoSubmitOnEnd);

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">Voice input</h3>
        <p className="text-xs text-muted-fg">
          Speech-to-text for prompts. This preference is per-tab/per-device
          (localStorage), not synced.
        </p>
      </div>

      <div className="space-y-4">
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
              Silence grace window after the recognition stops detecting speech.
              With auto-submit on, the prompt is sent when this expires; with
              auto-submit off, the transcript stays in the composer.
            </p>
          </div>
        )}

        {mode !== "off" && (
          <div className="space-y-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSubmitOnEnd}
                onChange={(e) => setAutoSubmitOnEnd(e.target.checked)}
                className="mt-0.5 size-4 accent-accent"
                aria-label="Auto-submit after voice ends"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Auto-submit after voice ends
                </p>
                <p className="text-xs text-muted-fg">
                  When ON: the prompt is automatically submitted once the
                  grace window expires (current behavior). When OFF (default):
                  the transcribed text stays in the composer so you can edit
                  or add to it before submitting manually.
                </p>
              </div>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationSoundSetting() {
  const volume = useNotificationSoundStore((s) => s.volume);
  const setVolume = useNotificationSoundStore((s) => s.setVolume);

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">Notification sounds</h3>
        <p className="text-xs text-muted-fg">
          Per-event sound cues, copied from the opencode web UI. Browsers
          may suppress autoplay until you have interacted with the page at
          least once.
        </p>
      </div>
      <div className="space-y-3">
        <label className="block text-xs text-muted-fg">
          Volume: {Math.round(volume * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(volume * 100)}
            onChange={(e) => setVolume(parseInt(e.target.value, 10) / 100)}
            className="mt-1 block w-full"
            data-test="portal-settings-notification-sound-volume"
          />
        </label>
        <div className="divide-y divide-border rounded-md border border-border">
          <SoundCategoryRow
            category="agent"
            title="Agent"
            description="Play sound when the agent is complete or needs attention"
          />
          <SoundCategoryRow
            category="permissions"
            title="Permissions"
            description="Play sound when a permission is required"
          />
          <SoundCategoryRow
            category="errors"
            title="Errors"
            description="Play sound when an error occurs"
          />
        </div>
      </div>
    </div>
  );
}

function SoundCategoryRow({
  category,
  title,
  description,
}: {
  category: NotificationCategory;
  title: string;
  description: string;
}) {
  const cfg = useNotificationSoundStore((s) => s[category]);
  const setEnabled = useNotificationSoundStore((s) => s.setCategoryEnabled);
  const setSound = useNotificationSoundStore((s) => s.setCategorySound);
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-fg">{description}</span>
      </div>
      <Checkbox
        isSelected={cfg.enabled}
        onChange={(v) => setEnabled(category, Boolean(v))}
        data-test={`portal-settings-sound-${category}-enabled`}
        aria-label={`Enable ${title} sound`}
      >
        Enabled
      </Checkbox>
      <Select
        aria-label={`${title} sound`}
        selectedKey={cfg.soundId}
        onSelectionChange={(key) => {
          if (!key) return;
          const id = String(key) as SoundId;
          setSound(category, id);
          playSoundById(id);
        }}
        className="shrink-0"
      >
        <SelectTrigger className="w-40" />
        <SelectContent
          className="max-h-[min(60vh,20rem)]"
          popover={{
            className: "max-h-[min(60vh,20rem)] flex flex-col overflow-hidden",
          }}
        >
          {SOUND_OPTIONS.map((opt) => (
            <SelectItem key={opt.id} id={opt.id} textValue={opt.label}>
              <SelectLabel>{opt.label}</SelectLabel>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        onClick={() => playSoundById(cfg.soundId)}
        className="rounded-md border border-border bg-bg px-2 py-1 text-xs hover:bg-muted"
        data-test={`portal-settings-sound-${category}-test`}
      >
        Test
      </button>
    </div>
  );
}

function TitleBarActionsSetting() {
  const placements = useTitleBarActionsStore((s) => s.placements);
  const setPlacement = useTitleBarActionsStore((s) => s.setPlacement);
  const reset = useTitleBarActionsStore((s) => s.reset);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">
          Title-bar action shortcuts
        </h3>
        <p className="text-xs text-muted-fg">
          Choose whether each session action lives only in the
          hamburger menu, or appears as a shortcut button on the
          session title bar AS WELL (the hamburger entry stays
          available in both modes). Per-action so you can clutter
          only what you actually use.
        </p>
      </div>
      <div className="space-y-3">
        {SESSION_ACTIONS.map((action) => {
          const current = placements[action.id];
          return (
            <div key={action.id} className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{action.label}</span>
              </div>
              <p className="text-xs text-muted-fg">{action.description}</p>
              <div className="flex gap-1">
                {(["hamburger", "both"] as ActionPlacement[]).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      setPlacement(action.id as SessionActionId, opt)
                    }
                    className={`rounded-md border px-2 py-1 text-xs ${
                      current === opt
                        ? "border-accent bg-accent/10 text-fg"
                        : "border-border bg-bg text-muted-fg hover:bg-muted"
                    }`}
                    data-test={`portal-settings-titlebar-${action.id}-${opt}`}
                  >
                    {opt === "hamburger" ? "Hamburger only" : "Title bar + hamburger"}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-muted-fg hover:bg-muted"
        data-test="portal-settings-titlebar-reset"
      >
        Reset to defaults
      </button>
    </div>
  );
}

function TtsSetting() {
  const enabled = useTtsStore((s) => s.enabled);
  const setEnabled = useTtsStore((s) => s.setEnabled);
  const rate = useTtsStore((s) => s.rate);
  const setRate = useTtsStore((s) => s.setRate);
  const pitch = useTtsStore((s) => s.pitch);
  const setPitch = useTtsStore((s) => s.setPitch);
  const voiceName = useTtsStore((s) => s.voice);
  const setVoice = useTtsStore((s) => s.setVoice);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, []);

  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">
          Text-to-speech (assistant replies)
        </h3>
        <p className="text-xs text-muted-fg">
          Read assistant responses aloud as they finish, using your
          browser's built-in speech synthesis. Markdown formatting is
          stripped before speaking; code blocks read as
          &ldquo;[code block]&rdquo;.
        </p>
      </div>
      {!supported ? (
        <p className="text-xs text-danger-subtle-fg">
          Your browser does not support the Web Speech Synthesis API.
        </p>
      ) : (
        <div className="space-y-3">
          <Checkbox
            isSelected={enabled}
            onChange={(v) => setEnabled(Boolean(v))}
            data-test="portal-settings-tts-enabled"
          >
            Enable text-to-speech for assistant replies
          </Checkbox>
          {enabled && (
            <div className="space-y-3">
              <label className="block text-xs text-muted-fg">
                Voice
                <select
                  className="mt-1 block w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
                  value={voiceName ?? ""}
                  onChange={(e) => setVoice(e.target.value || null)}
                  data-test="portal-settings-tts-voice"
                >
                  <option value="">System default</option>
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-muted-fg">
                Rate: {rate.toFixed(1)}x
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={rate}
                  onChange={(e) => setRate(parseFloat(e.target.value))}
                  className="mt-1 block w-full"
                  data-test="portal-settings-tts-rate"
                />
              </label>
              <label className="block text-xs text-muted-fg">
                Pitch: {pitch.toFixed(1)}
                <input
                  type="range"
                  min={0}
                  max={2.0}
                  step={0.1}
                  value={pitch}
                  onChange={(e) => setPitch(parseFloat(e.target.value))}
                  className="mt-1 block w-full"
                  data-test="portal-settings-tts-pitch"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    speakText(
                      "This is a test of the openportal text to speech feature.",
                    )
                  }
                  className="rounded-md border border-border bg-bg px-2 py-1 text-xs hover:bg-muted"
                  data-test="portal-settings-tts-test"
                >
                  Test voice
                </button>
                <button
                  type="button"
                  onClick={() => stopSpeaking()}
                  className="rounded-md border border-border bg-bg px-2 py-1 text-xs hover:bg-muted"
                  data-test="portal-settings-tts-stop"
                >
                  Stop
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Legacy global tool-output cap. Section I-2 moved server-side trimming
// to the per-content-type rules table above. This single-knob setting
// remains as a fallback ONLY for the "tool-call-output" content type
// when its rule is at the default (show-fully + null maxBytes). Once
// users migrate to the table, this control can be removed.
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
          data-test="portal-settings-save-tooloutputcap"
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

function FilesSettings() {
  const showHidden = useFileBrowserSettingsStore((s) => s.showHidden);
  const showModDate = useFileBrowserSettingsStore((s) => s.showModDate);
  const showFileSize = useFileBrowserSettingsStore((s) => s.showFileSize);
  const showDirSize = useFileBrowserSettingsStore((s) => s.showDirSize);
  const setShowHidden = useFileBrowserSettingsStore((s) => s.setShowHidden);
  const setShowModDate = useFileBrowserSettingsStore((s) => s.setShowModDate);
  const setShowFileSize = useFileBrowserSettingsStore((s) => s.setShowFileSize);
  const setShowDirSize = useFileBrowserSettingsStore((s) => s.setShowDirSize);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">View options</h3>
          <p className="text-xs text-muted-fg">
            What the file browser shows by default. Same toggles are
            available in-place via the cog icon left of the close button
            in any file browser surface.
          </p>
        </div>
        <div className="space-y-2">
          <Checkbox
            isSelected={showHidden}
            onChange={setShowHidden}
            data-test="portal-settings-files-hidden"
          >
            Show hidden files
          </Checkbox>
          <Checkbox
            isSelected={showModDate}
            onChange={setShowModDate}
            data-test="portal-settings-files-moddate"
          >
            Show mod date column
          </Checkbox>
          <Checkbox
            isSelected={showFileSize}
            onChange={setShowFileSize}
            data-test="portal-settings-files-filesize"
          >
            Show file size column
          </Checkbox>
          <Checkbox
            isSelected={showDirSize}
            onChange={setShowDirSize}
            data-test="portal-settings-files-dirsize"
          >
            Show directory size{" "}
            <span className="text-muted-fg text-xs">(may be slow)</span>
          </Checkbox>
        </div>
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Keyboard shortcuts</h3>
          <p className="text-xs text-muted-fg">
            Active inside any file browser surface, including the
            side-panel iframe (works whether focus is in the browser or
            in the parent chat).
          </p>
        </div>
        <ul className="text-xs space-y-1">
          <li className="flex items-center gap-2">
            <kbd className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono">
              Ctrl+Shift+L
            </kbd>
            <span className="text-muted-fg">(or</span>
            <kbd className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono">
              Cmd+Shift+L
            </kbd>
            <span className="text-muted-fg">)</span>
            <span>Focus + select the address bar</span>
          </li>
        </ul>
      </section>
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
  const sessionsQuery = useSessions();
  const [pendingRemove, setPendingRemove] = React.useState<string | null>(null);
  const [busyDefault, setBusyDefault] = React.useState(false);
  const [confirmClearAll, setConfirmClearAll] = React.useState(false);
  const [clearBusy, setClearBusy] = React.useState(false);

  const sessionTitles = React.useMemo(() => {
    const sessions = (sessionsQuery.data ?? []) as Array<{
      id?: string;
      title?: string;
    }>;
    const map: Record<string, string> = {};
    for (const s of sessions) {
      if (typeof s.id === "string" && typeof s.title === "string") {
        map[s.id] = s.title;
      }
    }
    return map;
  }, [sessionsQuery.data]);

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
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">
            Auto-approve permissions globally
          </h3>
          <p className="text-xs text-muted-fg">
            Applied to every session that has no per-session override below.
            The composer shield toggle in each chat sets an override for
            that session. The OpenPortal server fires the auto-replies
            itself - independent of any browser tab being open - and every
            reply lands in the chat audit trail with an &quot;auto&quot;
            badge.
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
            <h3 className="text-sm font-semibold">
              Per-session auto-approve overrides
            </h3>
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
                  {sessionTitles[sid] ? (
                    <div className="text-sm truncate">{sessionTitles[sid]}</div>
                  ) : (
                    <div className="text-xs text-muted-fg italic">
                      {sessionsQuery.isLoading ? "Loading title..." : "(no title)"}
                    </div>
                  )}
                  <div className="font-mono text-xs text-muted-fg truncate">
                    {sid}
                  </div>
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
  const { fontFamily, setFontFamily, ligatures, setLigatures } = useTheme();
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
      "files",
      "tools",
      "content",
      "notifications",
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
          "files",
          "tools",
          "content",
          "notifications",
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
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
      <div className="container mx-auto space-y-8 px-4 py-6">
      <Tabs
        aria-label="Settings"
        className="overflow-x-clip"
        selectedKey={settingsTab}
        onSelectionChange={(key) => setSettingsTab(String(key))}
      >
        {/* Sticky tab strip - the strip stays pinned to the top of the
            scroll container as the user scrolls through a long tab
            panel, mirroring the always-visible app title bar above. The
            negative horizontal margin + positive padding pair lets the
            bg-bg band span the inner container's full width (incl. the
            container's px-4 padding) so panel content scrolling
            underneath cannot bleed through the sticky band. `-top-px`
            offsets a sub-pixel fractional-scroll gap that browsers
            occasionally leave above sticky elements on retina /
            zoom-not-100% displays. overflow-x-clip on the parent
            preserves the original "no horizontal page scroll" intent
            without creating a vertical scroll context (which
            overflow-x-hidden does as a side effect and would break the
            sticky binding to the outer scroll container). */}
        <TabList className="sticky -top-px z-20 -mx-4 flex overflow-x-auto bg-bg px-4 scrollbar-none border-b border-border [&_*[data-slot=selected-indicator]]:hidden">
          <Tab id="appearance" data-test="portal-settings-tab-appearance">
            <SwatchIcon className="size-4" data-slot="icon" />
            Appearance
          </Tab>
          <Tab id="prompt" data-test="portal-settings-tab-prompt">
            <PencilSquareIcon className="size-4" data-slot="icon" />
            Prompt
          </Tab>
          <Tab id="composer" data-test="portal-settings-tab-composer">
            <ChatBubbleLeftEllipsisIcon className="size-4" data-slot="icon" />
            Composer
          </Tab>
          <Tab id="chat" data-test="portal-settings-tab-chat">
            <ChatBubbleLeftRightIcon className="size-4" data-slot="icon" />
            Chat
          </Tab>
          <Tab id="files" data-test="portal-settings-tab-files">
            <FolderIcon className="size-4" data-slot="icon" />
            Files
          </Tab>
          <Tab id="tools" data-test="portal-settings-tab-tools">
            <WrenchScrewdriverIcon className="size-4" data-slot="icon" />
            Tools
          </Tab>
          <Tab id="content" data-test="portal-settings-tab-content">
            <EyeIcon className="size-4" data-slot="icon" />
            Content
          </Tab>
          <Tab id="notifications" data-test="portal-settings-tab-notifications">
            <BellIcon className="size-4" data-slot="icon" />
            Notifications
          </Tab>
          <Tab id="performance" data-test="portal-settings-tab-performance">
            <BoltIcon className="size-4" data-slot="icon" />
            Performance
          </Tab>
          <Tab id="diagnostics" data-test="portal-settings-tab-diagnostics">
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
                <p className="text-sm font-medium">Programming Ligatures</p>
                <p className="text-xs text-muted-fg">
                  Fonts that ship OpenType `calt` / `liga` features render
                  two-character sequences like `-&gt;`, `==`, `!=`, `&gt;=`,
                  `&lt;=` as single fused glyphs. Underlying text is
                  unchanged - this is purely visual.
                </p>
                <Checkbox
                  isSelected={ligatures}
                  onChange={(value) => setLigatures(Boolean(value))}
                  data-test="portal-settings-ligatures"
                >
                  Enable programming ligatures
                </Checkbox>
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

            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">Default model</h3>
                <p className="text-xs text-muted-fg">
                  The model used for generating code and responses. The server
                  default is marked, and your selection is remembered locally.
                </p>
              </div>
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

            <section>
              <NotificationSoundSetting />
            </section>

            <section>
              <TtsSetting />
            </section>
          </div>
        </TabPanel>

        <TabPanel id="composer" className="pt-6">
          <div className="space-y-10">
            <div>
              <h2 className="text-lg font-semibold">Composer</h2>
              <p className="text-xs text-muted-fg">
                How the prompt input behaves: Enter key, auto-approve
                permissions.
              </p>
            </div>

            <section>
              <ComposerSettings />
            </section>

            <section>
              <PermissionsSettings />
            </section>
          </div>
        </TabPanel>

        <TabPanel id="chat" className="pt-6">
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

            <section>
              <TitleBarActionsSetting />
            </section>
          </div>
        </TabPanel>

        <TabPanel id="files" className="pt-6">
          <div className="space-y-10">
            <div>
              <h2 className="text-lg font-semibold">Files</h2>
              <p className="text-xs text-muted-fg pt-1">
                Defaults for the file browser. Hidden-file visibility,
                metadata columns, optional directory-size scan.
              </p>
            </div>
            <FilesSettings />
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

        <TabPanel id="content" className="pt-6">
          <div className="space-y-10">
            <div>
              <h2 className="text-lg font-semibold">Content</h2>
              <p className="text-xs text-muted-fg pt-1">
                What shows in the chat log and how. Per-content-type visibility,
                byte caps, on-demand loading.
              </p>
            </div>
            <ContentVisibilityTable />
            <ToolOutputCapSetting />
          </div>
        </TabPanel>

        <TabPanel id="notifications" className="pt-6">
          <div className="space-y-10">
            <div>
              <h2 className="text-lg font-semibold">Notifications</h2>
              <p className="text-xs text-muted-fg pt-1">
                Per-status browser notification policy. Permission must be
                granted at the OS / browser level for notifications to fire
                regardless of these settings.
              </p>
            </div>
            <NotificationsSettings />
          </div>
        </TabPanel>

        <TabPanel id="performance" className="pt-6">
          <div className="space-y-10">
            <div>
              <h2 className="text-lg font-semibold">Performance</h2>
              <p className="text-xs text-muted-fg pt-1">
                Knobs that trade off responsiveness vs. resource usage. Affect how
                the UI behaves, not what content it shows.
              </p>
            </div>
            <LiveUpdatesSetting />
          </div>
        </TabPanel>

        <TabPanel id="diagnostics" className="pt-6">
          <div className="space-y-10">
            <DiagnosticsPanel />
            <StuckRecoverySettings />
          </div>
        </TabPanel>
      </Tabs>
      </div>
    </div>
  );
}
