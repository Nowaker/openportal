import { create } from "zustand";
import { persist } from "zustand/middleware";

export const FONT_SIZE_PRESETS = [0.75, 0.85, 1, 1.15, 1.3, 1.5] as const;
export type FontSizeScale = (typeof FONT_SIZE_PRESETS)[number];

export const DEFAULT_FONT_SIZE_SCALE: FontSizeScale = 1;

interface FontSizeState {
  scale: FontSizeScale;
  setScale: (scale: FontSizeScale) => void;
}

export const useFontSizeStore = create<FontSizeState>()(
  persist(
    (set) => ({
      scale: DEFAULT_FONT_SIZE_SCALE,
      setScale: (scale) => set({ scale }),
    }),
    {
      name: "opencode-font-size",
    },
  ),
);
