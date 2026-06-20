import { useCallback, useMemo } from "react";
import { useShortcut } from "./useShortcut";
import { usePostHog } from "posthog-js/react";
import { ChatModeSchema } from "../lib/schemas";
import { useChatMode } from "./useChatMode";
import { useRouterState } from "@tanstack/react-router";

export function useChatModeToggle() {
  const routerState = useRouterState();
  const routeChatId =
    routerState.location.pathname === "/chat"
      ? (routerState.location.search.id as number | undefined)
      : null;
  const { selectedMode, setChatMode, settings } = useChatMode(routeChatId);
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

  // Function to toggle between chat modes
  const toggleChatMode = useCallback(() => {
    if (!settings || !selectedMode) return;

    const currentMode = selectedMode;
    // Migration on read ensures currentMode is never "agent"
    const modes = ChatModeSchema.options;
    const currentIndex = modes.indexOf(currentMode);
    const newMode = modes[(currentIndex + 1) % modes.length];

    void setChatMode(newMode).catch(() => {});
    posthog.capture("chat:mode_toggle", {
      from: currentMode,
      to: newMode,
      trigger: "keyboard_shortcut",
    });
  }, [selectedMode, setChatMode, settings, posthog]);

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
type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

export function detectIsMac(): boolean {
  const nav = navigator as NavigatorWithUserAgentData;
  // Try modern API first
  if ("userAgentData" in nav && nav.userAgentData?.platform) {
    return nav.userAgentData.platform.toLowerCase().includes("mac");
  }

  // Fallback to user agent check
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}
// Export the utility function and hook for use elsewhere
export function useIsMac(): boolean {
  return useMemo(() => detectIsMac(), []);
}
