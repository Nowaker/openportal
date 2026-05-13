import { create } from "zustand";

interface FileBrowserPanelState {
  isOpen: boolean;
  initialPath: string | null;
  open: (path: string | null) => void;
  close: () => void;
}

export const useFileBrowserPanelStore = create<FileBrowserPanelState>(
  (set) => ({
    isOpen: false,
    initialPath: null,
    open: (path) => set({ isOpen: true, initialPath: path }),
    close: () => set({ isOpen: false, initialPath: null }),
  }),
);
