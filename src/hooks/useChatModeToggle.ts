import { useCallback, useMemo } from "react";
import { useSettings } from "./useSettings";
import { useShortcut } from "./useShortcut";
import { usePostHog } from "posthog-js/react";
import { ChatModeSchema } from "../lib/schemas";

/**
 * A hook for toggling the chat mode.
 * @returns {object} An object with a function to toggle the chat mode and a boolean indicating if the user is on a Mac.
 * @property {() => void} toggleChatMode - A function to toggle the chat mode.
 * @property {boolean} isMac - Whether the user is on a Mac.
 */
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
    if (!settings || !settings.selectedChatMode) return;

    const currentMode = settings.selectedChatMode;
    const modes = ChatModeSchema.options;
    const currentIndex = modes.indexOf(settings.selectedChatMode);
    const newMode = modes[(currentIndex + 1) % modes.length];

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

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

/**
 * Detects if the user is on a Mac.
 * @returns {boolean} Whether the user is on a Mac.
 */
export function detectIsMac(): boolean {
  const nav = navigator as NavigatorWithUserAgentData;
  // Try modern API first
  if ("userAgentData" in nav && nav.userAgentData?.platform) {
    return nav.userAgentData.platform.toLowerCase().includes("mac");
  }

  // Fallback to user agent check
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

/**
 * A hook to determine if the user is on a Mac.
 * @returns {boolean} Whether the user is on a Mac.
 */
export function useIsMac(): boolean {
  return useMemo(() => detectIsMac(), []);
}
