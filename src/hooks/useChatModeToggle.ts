import { useCallback, useMemo } from "react";
import { useSettings } from "./useSettings";
import { useShortcut } from "./useShortcut";
import { usePostHog } from "posthog-js/react";
import {
  ChatModeSchema,
  isChatModeAllowed,
  isDyadProEnabled,
} from "../lib/schemas";
import { persistChatModeToDb } from "@/lib/chatModeUtils";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import { toast } from "sonner";

export function useChatModeToggle() {
  const { settings, updateSettings, envVars } = useSettings();
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
    const freeAgentQuotaAvailable = !isQuotaExceeded;
    const allModes = ChatModeSchema.options;
    const availableModes = allModes.filter((mode) =>
      isChatModeAllowed(mode, settings, envVars, freeAgentQuotaAvailable),
    );
    const currentIndex = availableModes.indexOf(currentMode);
    // When current mode is filtered out (e.g., quota exceeded), start from the first mode
    // not from the next one to avoid skipping availableModes[0]
    const newMode =
      currentIndex >= 0
        ? availableModes[(currentIndex + 1) % availableModes.length]
        : availableModes[0];

    const localAgentUnavailableReason =
      currentMode === "local-agent" &&
      !isChatModeAllowed(
        "local-agent",
        settings,
        envVars,
        freeAgentQuotaAvailable,
      )
        ? !freeAgentQuotaAvailable
          ? "Agent mode unavailable — free quota exceeded"
          : "Agent mode requires an OpenAI or Anthropic provider"
        : null;

    if (localAgentUnavailableReason) {
      toast.error(localAgentUnavailableReason);
    }

    const initialChatId = chatId?.id;
    const initialPath = router.state.location.pathname;

    const getCurrentChatId = () => {
      if (!router.state.location.pathname.startsWith("/chat")) return undefined;
      const id = (router.state.location.search as Record<string, unknown>).id;
      return typeof id === "number" ? id : undefined;
    };

    // Persist to chat if we're in a chat (match ChatModeSelector pattern: persist first)
    if (chatId?.id) {
      const persistSucceeded = await persistChatModeToDb(
        chatId.id,
        newMode,
        () => queryClient.invalidateQueries({ queryKey: queryKeys.chats.all }), // on success
        () => {
          toast.error("Failed to save chat mode to database");
        }, // on error
      );
      if (!persistSucceeded) {
        return; // Don't update settings if DB persist failed
      }

      const currentChatId = getCurrentChatId();
      if (
        currentChatId !== initialChatId ||
        router.state.location.pathname !== initialPath
      ) {
        return; // Route changed while persisting; don't apply stale mode.
      }
    }

    // Apply change to settings only after DB save (if in chat) to prevent wrong-mode sends during persist window
    updateSettings({ selectedChatMode: newMode });
    posthog.capture("chat:mode_toggle", {
      from: currentMode,
      to: newMode,
      trigger: "keyboard_shortcut",
    });
  }, [
    settings,
    envVars,
    updateSettings,
    posthog,
    chatId,
    queryClient,
    router.state.location.pathname,
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
