import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FontFamily = "inter" | "geist-sans" | "geist-mono" | "system";

interface FontState {
  fontFamily: FontFamily;
  setFontFamily: (font: FontFamily) => void;
  ligatures: boolean;
  setLigatures: (on: boolean) => void;
}

export const useFontStore = create<FontState>()(
  persist(
    (set) => ({
      fontFamily: "inter",
      setFontFamily: (font) => set({ fontFamily: font }),
      ligatures: true,
      setLigatures: (on) => set({ ligatures: on }),
    }),
    {
      name: "opencode-font-family",
    },
  ),
);
