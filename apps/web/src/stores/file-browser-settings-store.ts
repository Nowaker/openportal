import { create } from "zustand";
import { persist } from "zustand/middleware";

// Per-tab visibility toggles for the file browser, mirrored by a
// quick-settings cog in the file-browser TopBar and a full "Files"
// tab in the Settings page. Defaults match the user's spec: hidden
// files, mod-date column, file-size column all ON; directory size
// OFF (recursive readdir+lstat can be slow on large trees, so we
// gate it behind explicit opt-in).
//
// localStorage-only, no server roundtrip - these are display
// preferences with zero impact on data flow, identical pattern to
// composer-store / font-size-store / chat-link-store.

interface FileBrowserSettingsState {
  showHidden: boolean;
  showModDate: boolean;
  showFileSize: boolean;
  showDirSize: boolean;
  setShowHidden: (value: boolean) => void;
  setShowModDate: (value: boolean) => void;
  setShowFileSize: (value: boolean) => void;
  setShowDirSize: (value: boolean) => void;
}

export const useFileBrowserSettingsStore = create<FileBrowserSettingsState>()(
  persist(
    (set) => ({
      showHidden: true,
      showModDate: true,
      showFileSize: true,
      showDirSize: false,
      setShowHidden: (value) => set({ showHidden: value }),
      setShowModDate: (value) => set({ showModDate: value }),
      setShowFileSize: (value) => set({ showFileSize: value }),
      setShowDirSize: (value) => set({ showDirSize: value }),
    }),
    {
      name: "openportal-file-browser-settings",
    },
  ),
);
