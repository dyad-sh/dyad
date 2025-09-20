import { useCallback, useMemo } from "react";
import { useSettings } from "./useSettings";
import { useShortcut } from "./useShortcut";
import { usePostHog } from "posthog-js/react";

export function useChatModeToggle() {
  const { settings, updateSettings } = useSettings();
  const posthog = usePostHog();

  // Detect if user is on mac
  const isMac = useIsMac();

  // Memoize the modifiers object to prevent re-registration
  const modifiers = useMemo(
    () => ({
      ctrl: !isMac,
      meta: isMac,
    }),
    [isMac],
  );

  // Function to toggle between ask and build chat modes
  const toggleChatMode = useCallback(() => {
    if (!settings) return;

    const currentMode = settings.selectedChatMode;
    const newMode = currentMode === "ask" ? "build" : "ask";

    updateSettings({ selectedChatMode: newMode });
    posthog.capture("chat:mode_toggle", {
      from: currentMode,
      to: newMode,
      trigger: "keyboard_shortcut",
    });
  }, [settings, updateSettings, posthog]);

  // Add keyboard shortcut with memoized modifiers
  useShortcut(
    ".",
    modifiers,
    toggleChatMode,
    true, // Always enabled since we're not dependent on component selector
  );

  return { toggleChatMode, isMac };
}

// Add this function at the top
function detectIsMac(): boolean {
  // Try modern API first
  if (
    "userAgentData" in navigator &&
    (navigator as any).userAgentData?.platform
  ) {
    return (navigator as any).userAgentData.platform
      .toLowerCase()
      .includes("mac");
  }

  // Fallback to user agent check
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}
// Export the utility function and hook for use elsewhere
export function useIsMac(): boolean {
  return useMemo(() => detectIsMac(), []);
}

export { detectIsMac };
