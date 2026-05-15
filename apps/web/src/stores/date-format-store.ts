import { create } from "zustand";
import { persist } from "zustand/middleware";

// "locale" uses the browser's resolved locale + hour12 preference. The
// 12h/24h overrides force the corresponding format regardless of
// locale - useful for users whose locale defaults to a format they
// dislike (e.g. en-GB 24h users who prefer 12h).
export type DateFormat = "locale" | "12h" | "24h";

interface DateFormatState {
  format: DateFormat;
  setFormat: (f: DateFormat) => void;
}

export const useDateFormatStore = create<DateFormatState>()(
  persist(
    (set) => ({
      format: "locale",
      setFormat: (format) => set({ format }),
    }),
    { name: "opencode-date-format" },
  ),
);
