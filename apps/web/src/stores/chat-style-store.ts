import { create } from "zustand";
import { persist } from "zustand/middleware";

// How chat messages are drawn. `portal` is OpenPortal's own look and the
// default everywhere; `terminal` is an opt-in that draws messages the way
// the opencode TUI does (see lib/tui-theme.ts and the --oc-* rules in
// main.css), for people who move between the portal and a terminal tab.
export type ChatStyle = "portal" | "terminal";

interface ChatStyleState {
  chatStyle: ChatStyle;
  setChatStyle: (style: ChatStyle) => void;
}

export const useChatStyleStore = create<ChatStyleState>()(
  persist(
    (set) => ({
      chatStyle: "portal",
      setChatStyle: (chatStyle) => set({ chatStyle }),
    }),
    {
      name: "opencode-chat-style",
    },
  ),
);

export function useTerminalChatStyle(): boolean {
  return useChatStyleStore((s) => s.chatStyle) === "terminal";
}
