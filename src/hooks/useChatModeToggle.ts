import { useCallback } from "react";
import { useSettings } from "./useSettings";
import { useShortcut } from "./useShortcut";
import { usePostHog } from "posthog-js/react";

export function useChatModeToggle() {
  const { settings, updateSettings } = useSettings();
  const posthog = usePostHog();

  // Detect if user is on mac
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

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

  // Add keyboard shortcut
  useShortcut(
    "a",
    { shift: true, ctrl: !isMac, meta: isMac },
    toggleChatMode,
    true, // Always enabled since we're not dependent on component selector
  );

  return { toggleChatMode, isMac };
}
