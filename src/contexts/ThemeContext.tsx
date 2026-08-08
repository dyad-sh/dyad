import { createContext, useContext, useEffect, useState } from "react";

import {
  migrateLegacyTheme,
  migrateStoredTheme,
  resolveThemeChoice,
  type ThemeChoice,
} from "@/lib/ui_themes";

export type Theme = ThemeChoice;

const STORAGE_KEY = "ui-theme";
const LEGACY_STORAGE_KEY = "theme";

function readStoredTheme(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return migrateStoredTheme(stored);
  // Upgrade the old light/dark/system value once, preserving what the user saw.
  const legacy = migrateLegacyTheme(localStorage.getItem(LEGACY_STORAGE_KEY));
  return legacy ?? "holographic";
}

function applyTheme(choice: ThemeChoice) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const { base, uiTheme } = resolveThemeChoice(choice, prefersDark);
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(base);
  root.dataset.uiTheme = uiTheme;
}

// Applied at import time — before React renders a frame — so startup never
// flashes the wrong theme.
try {
  applyTheme(readStoredTheme());
} catch {
  // Environments without a DOM (tests).
}

interface ThemeContextType {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(readStoredTheme);

  const setTheme = (next: ThemeChoice) => {
    setThemeState(next);
    // A brief cross-tint so surfaces glide between palettes instead of
    // snapping. Reduced motion strips the transition in CSS.
    const root = document.documentElement;
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 260);
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);

    // Only "system" changes with OS appearance, but re-applying is harmless.
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme(theme);
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  const [isDarkMode, setIsDarkMode] = useState(false);
  const { theme, setTheme } = context;

  useEffect(() => {
    const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      setIsDarkMode(
        resolveThemeChoice(theme, darkModeQuery.matches).base === "dark",
      );
    };
    update();
    darkModeQuery.addEventListener("change", update);
    return () => darkModeQuery.removeEventListener("change", update);
  }, [theme]);

  return { theme, isDarkMode, setTheme };
}
