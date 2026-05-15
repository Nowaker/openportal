import { create } from "zustand";
import { persist } from "zustand/middleware";

// Default to "new-tab" so the chat scroll position is preserved when the
// user clicks a link - which is the original behaviour shipped in
// 6b6cbeb + 4773b22. The user can switch to:
//   new-window  popup window via window.open, useful for side-by-side
//               reading without leaving the chat tab
//   this-tab    target=_self - replaces the chat tab, the user has to
//               come back. Some readers prefer this for keyboard nav.
//   none        do not render <a> at all; URLs appear as inert text.
//               For users who do not want accidental clicks (mobile).
export type ChatLinkBehavior =
  | "new-tab"
  | "new-window"
  | "this-tab"
  | "none";

interface ChatLinkState {
  behavior: ChatLinkBehavior;
  setBehavior: (b: ChatLinkBehavior) => void;
}

export const useChatLinkStore = create<ChatLinkState>()(
  persist(
    (set) => ({
      behavior: "new-tab",
      setBehavior: (behavior) => set({ behavior }),
    }),
    { name: "openportal-chat-link-behavior" },
  ),
);
