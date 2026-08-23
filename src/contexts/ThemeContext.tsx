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

  // The query owns the fetch. `staleTime: Infinity` keeps it to the single
  // bootstrap call; every later value arrives on the nativeThemeUpdated event
  // below and is written straight into this cache entry.
  const nativeThemeQuery = useQuery({
    queryKey: queryKeys.system.nativeTheme,
    queryFn: () => ipc.system.getNativeThemeState(),
    staleTime: Infinity,
  });

  useEffect(() => {
    // A main-to-renderer event and the query's own bootstrap reply are
    // unordered, so an event that lands first must not be overwritten by an
    // older invoke resolving afterwards. Cancelling the in-flight query is what
    // enforces that: TanStack drops the response of a cancelled fetch instead
    // of writing it over the newer value set here.
    const unsubscribe = ipc.events.system.onNativeThemeUpdated((state) => {
      void queryClient.cancelQueries({
        queryKey: queryKeys.system.nativeTheme,
      });
      queryClient.setQueryData(queryKeys.system.nativeTheme, state);
    });

    return unsubscribe;
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
