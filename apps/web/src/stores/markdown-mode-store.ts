import { create } from "zustand";
import { persist } from "zustand/middleware";

// Two independent markdown rendering modes, persisted per-device:
//
//   chat        - assistant/user messages in the chat log
//   pluginReadme - plugin info modal README block
//
// "default" = react-markdown + remark-gfm only (the original behaviour).
// "extended" = adds HTML pass-through (rehype-raw), GitHub callout
// styling (> [!TIP]/[!NOTE]/[!WARNING]/[!CAUTION]/[!IMPORTANT] via
// remark-github-blockquote-alert), and relative-URL rewriting against
// the source repository URL when known.
//
// Plugin READMEs default to "extended" because they're typically
// authored in GitHub-flavored markdown with those extensions in mind
// (see oh-my-openagent's README that motivated this). Chat defaults
// to "default" because LLM output rarely uses those extensions and
// rehype-raw widens the XSS surface (we render HTML the model wrote).
export interface MarkdownModeState {
  chat: "default" | "extended";
  pluginReadme: "default" | "extended";
  setChat: (mode: "default" | "extended") => void;
  setPluginReadme: (mode: "default" | "extended") => void;
}

export const useMarkdownModeStore = create<MarkdownModeState>()(
  persist(
    (set) => ({
      chat: "default",
      pluginReadme: "extended",
      setChat: (mode) => set({ chat: mode }),
      setPluginReadme: (mode) => set({ pluginReadme: mode }),
    }),
    {
      name: "openportal-markdown-mode",
    },
  ),
);
