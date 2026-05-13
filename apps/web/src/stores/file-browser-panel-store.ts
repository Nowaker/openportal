import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FileBrowserPanelState {
  isOpen: boolean;
  initialPath: string | null;
  open: (path: string | null) => void;
  toggle: (path: string | null) => void;
  close: () => void;
}

export const useFileBrowserPanelStore = create<FileBrowserPanelState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      initialPath: null,
      open: (path) => set({ isOpen: true, initialPath: path }),
      toggle: (path) => {
        const cur = get();
        if (cur.isOpen) set({ isOpen: false, initialPath: null });
        else set({ isOpen: true, initialPath: path });
      },
      close: () => set({ isOpen: false, initialPath: null }),
    }),
    { name: "openportal-file-browser-panel" },
  ),
);
