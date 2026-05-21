import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChatIconId =
  | "fork"
  | "revert"
  | "copy"
  | "expand"
  | "info"
  | "timestamp"
  | "star";

export type ChatPlatform = "desktop" | "mobile";

export const ALL_ICONS: ChatIconId[] = [
  "fork",
  "revert",
  "copy",
  "expand",
  "info",
  "timestamp",
  "star",
];

export const ICON_LABELS: Record<ChatIconId, string> = {
  fork: "Fork from here",
  revert: "Revert to here",
  copy: "Copy markdown",
  expand: "Expand tool call inline",
  info: "Show full info (modal)",
  timestamp: "Permalink timestamp",
  star: "Star message",
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
    star: true,
  },
  mobile: {
    fork: true,
    revert: true,
    copy: true,
    expand: true,
    info: false,
    timestamp: true,
    star: true,
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
      version: 2,
      migrate: (persisted, version) => {
        const obj =
          persisted && typeof persisted === "object"
            ? (persisted as Partial<ChatDisplayState>)
            : null;
        if (version < 2 && obj?.iconVisibility) {
          const fallback = defaultVisibility();
          for (const platform of ["desktop", "mobile"] as ChatPlatform[]) {
            const existing = obj.iconVisibility[platform] as
              | Partial<Record<ChatIconId, boolean>>
              | undefined;
            obj.iconVisibility[platform] = {
              ...fallback[platform],
              ...(existing ?? {}),
            };
          }
        }
        return obj as ChatDisplayState;
      },
    },
  ),
);
