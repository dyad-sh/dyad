import { useEffect, useState } from "react";

export function useTheme() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check if dark mode is enabled
    const checkDarkMode = () => {
      const isDarkMode =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      setIsDark(isDarkMode);
    };

    checkDarkMode();

    // Listen for theme changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      setIsDark(e.matches);
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  return { isDark };
}
