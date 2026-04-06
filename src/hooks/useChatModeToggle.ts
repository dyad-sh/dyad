import { useCallback, useMemo } from "react";
import { useSettings } from "./useSettings";
import { useShortcut } from "./useShortcut";
import { usePostHog } from "posthog-js/react";
import { ChatModeSchema, isDyadProEnabled } from "../lib/schemas";
import { persistChatModeToDb } from "@/lib/chatModeUtils";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import { toast } from "sonner";

export function useChatModeToggle() {
  const { settings, updateSettings } = useSettings();
  const posthog = usePostHog();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Memoize chatId to prevent recreation on every render (which would break useCallback)
  const chatId = useMemo(() => {
    if (!router.state.location.pathname.startsWith("/chat")) return undefined;
    const id = (router.state.location.search as Record<string, unknown>).id;
    return typeof id === "number" ? { id } : undefined;
  }, [router.state.location.pathname, router.state.location.search]);

  // Detect if user is on mac
  const isMac = useIsMac();

  // Check Pro status and quota status at top level
  const isProEnabled = settings ? isDyadProEnabled(settings) : false;
  const { isQuotaExceeded } = useFreeAgentQuota();

  // Memoize the modifiers object to prevent re-registration
  const modifiers = useMemo(
    () => ({
      ctrl: !isMac,
      meta: isMac,
    }),
    [isMac],
  );

  // Function to toggle between chat modes
  const toggleChatMode = useCallback(async () => {
    if (!settings || !settings.selectedChatMode) return;

    const currentMode = settings.selectedChatMode;
    // Migration on read ensures currentMode is never "agent"

    // Filter to only available modes based on user's access level
    const allModes = ChatModeSchema.options;
    const availableModes = allModes.filter((mode) => {
      // Pro users have access to all modes
      if (isProEnabled) return true;
      if (mode === "local-agent" && isQuotaExceeded) return false;
      return true;
    });
    const currentIndex = availableModes.indexOf(currentMode);
    // When current mode is filtered out (e.g., quota exceeded), start from the first mode
    // not from the next one to avoid skipping availableModes[0]
    const newMode =
      currentIndex >= 0
        ? availableModes[(currentIndex + 1) % availableModes.length]
        : availableModes[0];

    // Check if the shortcut would have landed on local-agent but it was filtered
    const nextInFullCycle =
      allModes[(allModes.indexOf(currentMode) + 1) % allModes.length];
    if (nextInFullCycle === "local-agent" && isQuotaExceeded && !isProEnabled) {
      toast.info("Agent mode unavailable — free quota exceeded");
    }

    updateSettings({ selectedChatMode: newMode });
    posthog.capture("chat:mode_toggle", {
      from: currentMode,
      to: newMode,
      trigger: "keyboard_shortcut",
    });

    // Persist to chat if we're in a chat (fire-and-forget like dropdown)
    if (chatId?.id) {
      await persistChatModeToDb(
        chatId.id,
        newMode,
        () => queryClient.invalidateQueries({ queryKey: queryKeys.chats.all }), // on success
        () => {
          updateSettings({ selectedChatMode: currentMode });
          queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
          toast.error("Failed to save chat mode to database");
        }, // on error
      );
    }
  }, [
    settings,
    updateSettings,
    posthog,
    chatId,
    queryClient,
    isProEnabled,
    isQuotaExceeded,
  ]);

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
