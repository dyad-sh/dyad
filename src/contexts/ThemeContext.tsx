import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";

import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

type Theme = "system" | "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  isDarkMode: boolean;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<Theme>(() => {
    // Try to get the saved theme from localStorage
    const savedTheme = localStorage.getItem("theme") as Theme;
    return savedTheme || "system";
  });
  const [systemThemeFallback] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  const nativeThemeQuery = useQuery({
    queryKey: queryKeys.system.nativeTheme,
    queryFn: () => ipc.system.getNativeThemeState(),
    staleTime: Infinity,
    enabled: false,
  });

  useEffect(() => {
    let active = true;
    let eventGeneration = 0;
    const unsubscribe = ipc.events.system.onNativeThemeUpdated((state) => {
      eventGeneration += 1;
      queryClient.setQueryData(queryKeys.system.nativeTheme, state);
    });

    // Subscribe before requesting the initial state: invoke replies and
    // main-to-renderer events are unordered, so a newer event must win over an
    // older bootstrap response that happens to resolve later.
    const requestGeneration = eventGeneration;
    void ipc.system
      .getNativeThemeState()
      .then((state) => {
        if (active && eventGeneration === requestGeneration) {
          queryClient.setQueryData(queryKeys.system.nativeTheme, state);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      unsubscribe();
    };
  }, [queryClient]);

  const isDarkMode =
    theme === "dark" ||
    (theme === "system" &&
      (nativeThemeQuery.data?.shouldUseDarkColors ?? systemThemeFallback));

  useEffect(() => {
    // Save theme preference to localStorage
    localStorage.setItem("theme", theme);

    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(isDarkMode ? "dark" : "light");
  }, [isDarkMode, theme]);

  return (
    <ThemeContext.Provider value={{ theme, isDarkMode, setTheme }}>
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
