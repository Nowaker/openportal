import { create } from "zustand";
import { persist } from "zustand/middleware";

export type EnterKeyAction = "submit" | "newline";

interface ComposerState {
  enterKeyAction: EnterKeyAction;
  setEnterKeyAction: (action: EnterKeyAction) => void;
}

export const useComposerStore = create<ComposerState>()(
  persist(
    (set) => ({
      enterKeyAction: "submit",
      setEnterKeyAction: (action) => set({ enterKeyAction: action }),
    }),
    {
      name: "opencode-composer",
    },
  ),
);
