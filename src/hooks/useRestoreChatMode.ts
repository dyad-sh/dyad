import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import {
  isChatModeAllowed,
  isDyadProEnabled,
  getEffectiveDefaultChatMode,
  type ChatMode,
  type ChatSummary,
  type UserSettings,
} from "@/lib/schemas";
import {
  getChatModeLabelKey,
  resolveAllowedChatMode,
} from "@/lib/chatModeUtils";

type UseRestoreChatModeOptions = {
  chatId?: number;
  appId?: number | null;
  settings: UserSettings | null | undefined;
  envVars: Record<string, string | undefined>;
  isQuotaExceeded: boolean;
  isContextReady: boolean;
  updateSettings: (
    settings: Partial<UserSettings>,
  ) => Promise<UserSettings | undefined>;
};

//This hook restores and validates a chat’s mode on load and  syncing it with settings

export function useRestoreChatMode({
  chatId,
  appId,
  settings,
  envVars,
  isQuotaExceeded,
  isContextReady,
  updateSettings,
}: UseRestoreChatModeOptions) {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();
  const [isRestoringMode, setIsRestoringMode] = useState(false);
  const lastRestoredChatIdRef = useRef<number | undefined>(undefined);
  const lastRestoredAppIdRef = useRef<number | null>(null);
  //  avoid stale data
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const envVarsRef = useRef(envVars);
  envVarsRef.current = envVars;
  const isQuotaExceededRef = useRef(isQuotaExceeded);
  isQuotaExceededRef.current = isQuotaExceeded;
  const isContextReadyRef = useRef(isContextReady);
  isContextReadyRef.current = isContextReady;

  useEffect(() => {
    if (settingsRef.current?.selectedChatMode !== "local-agent") {
      return;
    }
    lastRestoredChatIdRef.current = undefined;
    lastRestoredAppIdRef.current = null;
  }, [isQuotaExceeded]);

  useEffect(() => {
    if (!chatId || !settingsRef.current || !isContextReadyRef.current) {
      return;
    }
    if (
      lastRestoredChatIdRef.current === chatId &&
      lastRestoredAppIdRef.current === appId
    ) {
      return;
    }

    let isCancelled = false;
    const restoreAbortController = new AbortController();
    let bannerTimeoutId: number | undefined;

    const setBannerVisible = () => {
      if (!isCancelled) setIsRestoringMode(true);
    };

    // Snapshot values to avoid race conditions
    const snapshottedSettings = { ...settingsRef.current };
    const snapshottedEnvVars = { ...envVarsRef.current };
    const snapshottedIsQuotaExceeded = isQuotaExceededRef.current;
    const selectedModeAtRestoreStart = snapshottedSettings.selectedChatMode;

    const resolveModeForCandidate = (
      candidateMode: ChatSummary["chatMode"],
    ) => {
      const effectiveCandidateMode: ChatMode =
        candidateMode ??
        snapshottedSettings.selectedChatMode ??
        getEffectiveDefaultChatMode(
          snapshottedSettings,
          snapshottedEnvVars,
          !snapshottedIsQuotaExceeded,
        );

      let fallbackMode = snapshottedSettings.selectedChatMode ?? "build";
      if (
        !isChatModeAllowed(
          fallbackMode,
          snapshottedSettings,
          snapshottedEnvVars,
          !snapshottedIsQuotaExceeded,
        )
      ) {
        fallbackMode = "build";
      }

      const resolvedMode = resolveAllowedChatMode({
        desiredMode: effectiveCandidateMode,
        fallbackMode,
        settings: snapshottedSettings,
        envVars: snapshottedEnvVars,
        freeAgentQuotaAvailable: !snapshottedIsQuotaExceeded,
      });

      return { effectiveCandidateMode, resolvedMode };
    };

    const restoreTimeout = window.setTimeout(() => {
      if (!isCancelled && !restoreAbortController.signal.aborted) {
        restoreAbortController.abort();
        const isProEnabled = isDyadProEnabled(snapshottedSettings);
        const modeLabel = t(
          getChatModeLabelKey(snapshottedSettings.selectedChatMode ?? "build", {
            isProEnabled,
          }),
          { defaultValue: "Build" },
        );
        console.warn(
          `Chat mode restore timed out for chat ${chatId}; showing input anyway.`,
        );
        toast.warning(
          t("chatMode.restoreModeTimedOut", {
            defaultValue:
              "Couldn't restore this chat's mode in time - using {{mode}}.",
            mode: modeLabel,
          }),
          { id: `restore-timeout-${chatId}` },
        );
        setIsRestoringMode(false);
      }
    }, 2000);

    const clearRestoreTimeout = () => {
      window.clearTimeout(restoreTimeout);
      if (bannerTimeoutId !== undefined) {
        window.clearTimeout(bannerTimeoutId);
      }
    };

    const applyResolvedMode = async (
      candidateMode: ChatSummary["chatMode"],
    ) => {
      if (restoreAbortController.signal.aborted || isCancelled) {
        clearRestoreTimeout();
        setIsRestoringMode(false);
        return;
      }

      if (!snapshottedSettings) {
        if (!isCancelled) {
          clearRestoreTimeout();
          setIsRestoringMode(false);
        }
        return;
      }

      const { effectiveCandidateMode, resolvedMode } =
        resolveModeForCandidate(candidateMode);

      const shouldApplyToSettings =
        settingsRef.current?.selectedChatMode === selectedModeAtRestoreStart;
      const shouldSwitchMode =
        shouldApplyToSettings &&
        settingsRef.current?.selectedChatMode !== resolvedMode.mode;

      clearRestoreTimeout();

      if (resolvedMode.usedFallback && shouldSwitchMode) {
        toast.info(
          t("chatMode.modeUnavailableFallback", {
            defaultValue:
              "{{mode}} mode unavailable — switched this chat to {{fallbackMode}}",
            mode: t(
              getChatModeLabelKey(effectiveCandidateMode, {
                isProEnabled: isDyadProEnabled(snapshottedSettings),
              }),
              { defaultValue: "Build" },
            ),
            fallbackMode: t(
              getChatModeLabelKey(resolvedMode.mode, {
                isProEnabled: isDyadProEnabled(snapshottedSettings),
              }),
              { defaultValue: "Build" },
            ),
          }),
          { id: "restore-fallback-quota" },
        );

        // Apply fallback mode in settings for this session
        if (!isCancelled) {
          await updateSettings({ selectedChatMode: resolvedMode.mode }).catch(
            (error) => {
              console.error(
                "Failed to update settings for fallback mode:",
                error,
              );
            },
          );
        }

        if (!isCancelled) {
          setIsRestoringMode(false);
        }
      } else {
        if (
          !isCancelled &&
          !restoreAbortController.signal.aborted &&
          shouldApplyToSettings &&
          snapshottedSettings.selectedChatMode !== resolvedMode.mode
        ) {
          await updateSettings({ selectedChatMode: resolvedMode.mode }).catch(
            (error) => {
              console.error("Failed to restore selected chat mode:", error);
            },
          );
        }

        if (!isCancelled) {
          setIsRestoringMode(false);
        }
      }
    };

    const runRestore = async () => {
      try {
        const cachedChats = queryClient.getQueryData<ChatSummary[]>(
          queryKeys.chats.list({ appId: appId ?? null }),
        );
        const cachedChat = cachedChats?.find((c) => c.id === chatId);

        if (cachedChat) {
          const { resolvedMode: cachedResolvedMode } = resolveModeForCandidate(
            cachedChat.chatMode ?? null,
          );

          if (
            snapshottedSettings.selectedChatMode !== cachedResolvedMode.mode
          ) {
            setIsRestoringMode(true);
          }

          await applyResolvedMode(cachedChat.chatMode ?? null);
          lastRestoredChatIdRef.current = chatId;
          lastRestoredAppIdRef.current = appId ?? null;
          return;
        }

        if (isCancelled) return;

        const chat = await ipc.chat.getChat(chatId);
        if (isCancelled || restoreAbortController.signal.aborted) {
          clearRestoreTimeout();
          setIsRestoringMode(false);
          return;
        }

        const { resolvedMode: fetchedResolvedMode } = resolveModeForCandidate(
          chat.chatMode ?? null,
        );

        if (snapshottedSettings.selectedChatMode !== fetchedResolvedMode.mode) {
          bannerTimeoutId = window.setTimeout(setBannerVisible, 200);
        }

        await applyResolvedMode(chat.chatMode ?? null);

        lastRestoredChatIdRef.current = chatId;
        lastRestoredAppIdRef.current = appId ?? null;
      } catch (err) {
        console.error("Failed to restore chat mode on deep-link:", err);
        if (!isCancelled) {
          clearRestoreTimeout();
          setIsRestoringMode(false);
        }
      }
    };

    void runRestore();

    return () => {
      isCancelled = true;
      restoreAbortController.abort();
      clearRestoreTimeout();
      setIsRestoringMode(false);
    };
  }, [chatId, appId, isContextReady, isQuotaExceeded, t, updateSettings]);

  return { isRestoringMode };
}
