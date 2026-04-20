import { useCallback, useMemo, useRef } from "react";
import { useSettings } from "./useSettings";
import { useShortcut } from "./useShortcut";
import { usePostHog } from "posthog-js/react";
import {
  ChatModeSchema,
  getEffectiveDefaultChatMode,
  isChatModeAllowed,
  isDyadProEnabled,
} from "../lib/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import { toast } from "sonner";
import { usePersistChatMode } from "./usePersistChatMode";
import { useTranslation } from "react-i18next";
import { getChatModeLabelKey } from "@/lib/chatModeUtils";
import { ipc } from "@/ipc/types";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useCurrentChatIdFromRoute } from "./useCurrentChatIdFromRoute";
import { useIsMac } from "@/lib/platformUtils";
import { useChats } from "./useChats";

export function useChatModeToggle() {
  const { t } = useTranslation("chat");
  const { settings, updateSettings, envVars } = useSettings();
  const posthog = usePostHog();
  const queryClient = useQueryClient();
  const { persistChatMode } = usePersistChatMode();
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { chats } = useChats(selectedAppId);
  const getCurrentChatId = useCurrentChatIdFromRoute();

  const isMac = useIsMac();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();
  const modifiers = useMemo(
    () => ({
      ctrl: !isMac,
      meta: isMac,
    }),
    [isMac],
  );

  const toggleInFlightRef = useRef(false);
  const latestRef = useRef({
    settings,
    envVars,
    isQuotaLoading,
    isQuotaExceeded,
    selectedAppId,
    chats,
    updateSettings,
    getCurrentChatId,
    queryClient,
    persistChatMode,
    posthog,
    t,
  });
  latestRef.current = {
    settings,
    envVars,
    isQuotaLoading,
    isQuotaExceeded,
    selectedAppId,
    chats,
    updateSettings,
    getCurrentChatId,
    queryClient,
    persistChatMode,
    posthog,
    t,
  };

  const toggleChatMode = useCallback(async () => {
    if (toggleInFlightRef.current) {
      return;
    }

    toggleInFlightRef.current = true;

    let loadingToastId: string | number | undefined;
    let loadingToastTimerId: number | undefined;
    try {
      const {
        settings,
        envVars,
        isQuotaLoading,
        isQuotaExceeded,
        selectedAppId,
        chats,
        updateSettings,
        getCurrentChatId,
        queryClient,
        persistChatMode,
        posthog,
        t,
      } = latestRef.current;

      if (!settings) return;
      const currentMode =
        settings.selectedChatMode ??
        getEffectiveDefaultChatMode(settings, envVars, !isQuotaExceeded);

      const isProEnabled = isDyadProEnabled(settings);
      const freeAgentQuotaAvailable =
        isProEnabled || (!isQuotaLoading && !isQuotaExceeded);
      const allModes = ChatModeSchema.options;
      const availableModes = allModes.filter((mode) =>
        isChatModeAllowed(mode, settings, envVars, freeAgentQuotaAvailable),
      );
      if (availableModes.length === 0) {
        toast.error(
          t("chatMode.noneAvailable", {
            defaultValue: "No chat modes are currently available",
          }),
        );
        return;
      }

      const currentIndex = availableModes.indexOf(currentMode);
      // When current mode is filtered out (e.g., quota exceeded), start from the first mode
      // not from the next one to avoid skipping availableModes[0]
      const newMode =
        currentIndex >= 0
          ? availableModes[(currentIndex + 1) % availableModes.length]
          : availableModes[0];

      const modeLabels = {
        build: t(getChatModeLabelKey("build"), { defaultValue: "Build" }),
        ask: t(getChatModeLabelKey("ask"), { defaultValue: "Ask" }),
        "local-agent": t(getChatModeLabelKey("local-agent", { isProEnabled }), {
          defaultValue: isProEnabled ? "Agent" : "Basic Agent",
        }),
        plan: t(getChatModeLabelKey("plan"), { defaultValue: "Plan" }),
      };

      // If user was on local-agent and it became unavailable, show info toast about fallback
      if (
        currentMode === "local-agent" &&
        currentIndex === -1 &&
        !isChatModeAllowed(
          "local-agent",
          settings,
          envVars,
          freeAgentQuotaAvailable,
        )
      ) {
        toast.info(
          t("chatMode.agentFallbackSwitched", {
            defaultValue: "Agent mode unavailable — switched to {{mode}}",
            mode: modeLabels[newMode],
          }),
        );
      }

      const chatId = getCurrentChatId();
      let appIdForPersist: number | null = selectedAppId;
      if (!appIdForPersist && chatId) {
        appIdForPersist =
          chats.find((chat) => chat.id === chatId)?.appId ?? null;
      }
      if (!appIdForPersist && chatId) {
        const allChats = await ipc.chat.getChats(undefined);
        appIdForPersist =
          allChats.find((chat) => chat.id === chatId)?.appId ?? null;
      }

      loadingToastTimerId = window.setTimeout(() => {
        loadingToastId = toast.loading(
          t("chatMode.switching", {
            defaultValue: "Switching chat mode...",
          }),
        );
      }, 400);

      if (chatId && appIdForPersist) {
        const result = await persistChatMode({
          chatId,
          appId: appIdForPersist,
          chatMode: newMode,
          optimistic: true,
          onPersistSuccess: () =>
            queryClient.invalidateQueries({ queryKey: queryKeys.chats.all }),
          onPersistError: () => {
            toast.error(
              t("chatMode.persistFailed", {
                defaultValue: "Failed to save chat mode to database",
              }),
            );
          },
        });

        if (!result.success) {
          return;
        }
      } else {
        await updateSettings({ selectedChatMode: newMode });
      }

      posthog.capture("chat:mode_toggle", {
        from: currentMode,
        to: newMode,
        trigger: "keyboard_shortcut",
      });
    } finally {
      if (loadingToastTimerId !== undefined) {
        window.clearTimeout(loadingToastTimerId);
      }
      if (loadingToastId !== undefined) {
        toast.dismiss(loadingToastId);
      }
      toggleInFlightRef.current = false;
    }
  }, []);

  useShortcut(
    ".",
    modifiers,
    toggleChatMode,
    true, // Always enabled since we're not dependent on component selector
  );

  return { toggleChatMode, isMac };
}
