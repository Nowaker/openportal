import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DateFormat = "12h" | "24h";

interface DateFormatState {
  format: DateFormat;
  setFormat: (f: DateFormat) => void;
}

export const useDateFormatStore = create<DateFormatState>()(
  persist(
    (set) => ({
      format: "12h",
      setFormat: (format) => set({ format }),
    }),
    { name: "opencode-date-format" },
  ),
);
