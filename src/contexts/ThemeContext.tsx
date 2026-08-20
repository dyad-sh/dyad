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

  const nativeThemeQuery = useQuery({
    queryKey: queryKeys.system.nativeTheme,
    queryFn: () => ipc.system.getNativeThemeState(),
    staleTime: Infinity,
  });

  useEffect(
    () =>
      ipc.events.system.onNativeThemeUpdated((state) => {
        queryClient.setQueryData(queryKeys.system.nativeTheme, state);
      }),
    [queryClient],
  );

  const isDarkMode =
    theme === "dark" ||
    (theme === "system" && nativeThemeQuery.data?.shouldUseDarkColors === true);

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
