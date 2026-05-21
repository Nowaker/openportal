import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FileBrowserPanelState {
  isOpen: boolean;
  initialPath: string | null;
  initialFile: string | null;
  currentPath: string | null;
  currentFile: string | null;
  open: (path: string | null, file?: string | null) => void;
  toggle: (path: string | null) => void;
  close: () => void;
  navigated: (path: string | null, file: string | null) => void;
}

export const useFileBrowserPanelStore = create<FileBrowserPanelState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      initialPath: null,
      initialFile: null,
      currentPath: null,
      currentFile: null,
      open: (path, file) => set({ isOpen: true, initialPath: path, initialFile: file || null, currentPath: path, currentFile: file || null }),
      toggle: (path) => {
        const cur = get();
        if (cur.isOpen) set({ isOpen: false, initialPath: null, initialFile: null, currentPath: null, currentFile: null });
        else set({ isOpen: true, initialPath: path, initialFile: null, currentPath: path, currentFile: null });
      },
      close: () => set({ isOpen: false, initialPath: null, initialFile: null, currentPath: null, currentFile: null }),
      navigated: (path, file) => set({ currentPath: path, currentFile: file }),
    }),
    { name: "openportal-file-browser-panel" },
  ),
);
