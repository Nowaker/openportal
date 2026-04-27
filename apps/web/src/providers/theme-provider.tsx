import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useAccentStore, type AccentColor } from "@/stores/accent-store";
import { useFontStore, type FontFamily } from "@/stores/font-store";
import { useFontSizeStore } from "@/stores/font-size-store";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
  accentColor: AccentColor;
  setAccentColor: (color: AccentColor) => void;
  fontFamily: FontFamily;
  setFontFamily: (font: FontFamily) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "intentui-theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const resolved = theme === "system" ? getSystemTheme() : theme;

  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  return resolved;
}

function applyAccentColor(accentColor: AccentColor) {
  document.documentElement.setAttribute("data-accent", accentColor);
}

function applyFontFamily(fontFamily: FontFamily) {
  document.documentElement.setAttribute("data-font", fontFamily);
}

// Scale every rem-based size in the app by setting html.style.fontSize.
// Tailwind v4 expresses every text-* / spacing-* utility in rem, and rem is
// anchored to the html element's font-size. Scale 1 keeps the browser
// default (typically 16px); other scales multiply that. We do not hardcode
// 16px here so users who set a larger browser default still get a
// proportional bump.
function applyFontSizeScale(scale: number) {
  if (scale === 1) {
    document.documentElement.style.fontSize = "";
  } else {
    document.documentElement.style.fontSize = `${scale * 100}%`;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem(STORAGE_KEY) as Theme) || "system";
  });

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return theme === "system" ? getSystemTheme() : theme;
  });

  const accentColor = useAccentStore((state) => state.accentColor);
  const setAccentColor = useAccentStore((state) => state.setAccentColor);

  const fontFamily = useFontStore((state) => state.fontFamily);
  const setFontFamily = useFontStore((state) => state.setFontFamily);

  const fontSizeScale = useFontSizeStore((state) => state.scale);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
    const resolved = applyTheme(newTheme);
    setResolvedTheme(resolved);
  };

  useEffect(() => {
    const resolved = applyTheme(theme);
    setResolvedTheme(resolved);
  }, [theme]);

  useEffect(() => {
    applyAccentColor(accentColor);
  }, [accentColor]);

  useEffect(() => {
    applyFontFamily(fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    applyFontSizeScale(fontSizeScale);
  }, [fontSizeScale]);

  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const resolved = applyTheme("system");
      setResolvedTheme(resolved);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        resolvedTheme,
        accentColor,
        setAccentColor,
        fontFamily,
        setFontFamily,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
