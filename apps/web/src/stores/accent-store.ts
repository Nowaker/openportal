import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AccentColor = string;

interface AccentState {
  accentColor: AccentColor;
  setAccentColor: (color: AccentColor) => void;
}

export const useAccentStore = create<AccentState>()(
  persist(
    (set) => ({
      accentColor: "blue",
      setAccentColor: (color) => set({ accentColor: color }),
    }),
    {
      name: "opencode-accent-color",
    },
  ),
);
