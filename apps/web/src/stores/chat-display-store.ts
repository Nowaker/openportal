import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChatIconId =
  | "fork"
  | "revert"
  | "copy"
  | "expand"
  | "info"
  | "timestamp";

export type ChatPlatform = "desktop" | "mobile";

export const ALL_ICONS: ChatIconId[] = [
  "fork",
  "revert",
  "copy",
  "expand",
  "info",
  "timestamp",
];

export const ICON_LABELS: Record<ChatIconId, string> = {
  fork: "Fork from here",
  revert: "Revert to here",
  copy: "Copy markdown",
  expand: "Expand tool call inline",
  info: "Show full info (modal)",
  timestamp: "Permalink timestamp",
};

interface ChatDisplayState {
  iconVisibility: Record<ChatPlatform, Record<ChatIconId, boolean>>;
  hoverInfoEnabled: boolean;
  showInfoIcon: boolean;
  setIconVisibility: (
    platform: ChatPlatform,
    icon: ChatIconId,
    visible: boolean,
  ) => void;
  setHoverInfoEnabled: (enabled: boolean) => void;
  setShowInfoIcon: (show: boolean) => void;
}

const defaultVisibility = (): Record<ChatPlatform, Record<ChatIconId, boolean>> => ({
  desktop: {
    fork: true,
    revert: true,
    copy: true,
    expand: true,
    info: false,
    timestamp: true,
  },
  mobile: {
    fork: true,
    revert: true,
    copy: true,
    expand: true,
    info: false,
    timestamp: true,
  },
});

export const useChatDisplayStore = create<ChatDisplayState>()(
  persist(
    (set) => ({
      iconVisibility: defaultVisibility(),
      hoverInfoEnabled: true,
      showInfoIcon: false,
      setIconVisibility: (platform, icon, visible) =>
        set((s) => ({
          iconVisibility: {
            ...s.iconVisibility,
            [platform]: {
              ...s.iconVisibility[platform],
              [icon]: visible,
            },
          },
        })),
      setHoverInfoEnabled: (hoverInfoEnabled) => set({ hoverInfoEnabled }),
      setShowInfoIcon: (showInfoIcon) => set({ showInfoIcon }),
    }),
    {
      name: "openportal-chat-display",
      version: 1,
      migrate: (persisted, version) => {
        if (version === 0 && persisted && typeof persisted === "object") {
          return { ...defaultVisibility(), ...persisted };
        }
        return persisted as ChatDisplayState;
      },
    },
  ),
);
