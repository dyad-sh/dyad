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
import { usePersistChatMode } from "./usePersistChatMode";

type UseRestoreChatModeOptions = {
  chatId?: number;
  appId?: number | null;
  settings: UserSettings | null | undefined;
  envVars: Record<string, string | undefined>;
  isQuotaExceeded: boolean;
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
  updateSettings,
}: UseRestoreChatModeOptions) {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();
  const { persistChatMode } = usePersistChatMode();
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

  useEffect(() => {
    if (!chatId || !settingsRef.current) {
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

      // For null/undefined candidateMode (new chats) fall back to effective default
      const effectiveCandidateMode: ChatMode =
        candidateMode ??
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

      clearRestoreTimeout();

      if (resolvedMode.usedFallback) {
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

        // Update settings and persist fallback mode
        if (
          !isCancelled &&
          snapshottedSettings.selectedChatMode !== resolvedMode.mode
        ) {
          await updateSettings({ selectedChatMode: resolvedMode.mode }).catch(
            (error) => {
              console.error(
                "Failed to update settings for fallback mode:",
                error,
              );
            },
          );
        }

        if (!isCancelled && appId) {
          await persistChatMode({
            chatId,
            appId,
            chatMode: resolvedMode.mode,
            optimistic: false,
            onPersistSuccess: () =>
              queryClient.invalidateQueries({ queryKey: queryKeys.chats.all }),
            onPersistError: (error) => {
              console.error("Failed to persist fallback chat mode:", error);
            },
          });
        }

        if (!isCancelled) {
          setIsRestoringMode(false);
        }
      } else {
        if (!appId) {
          console.warn(
            `Skipping chat mode persist for chat ${chatId}: appId not available`,
          );
        } else if (resolvedMode.mode !== effectiveCandidateMode) {
          const persistResult = await persistChatMode({
            chatId,
            appId,
            chatMode: resolvedMode.mode,
            optimistic: false,
            onPersistSuccess: () =>
              queryClient.invalidateQueries({ queryKey: queryKeys.chats.all }),
            onPersistError: (error) => {
              console.error("Failed to persist restored chat mode:", error);
              toast.error(
                t("chatMode.persistFailed", {
                  defaultValue: "Failed to save chat mode to database",
                }),
                { id: `persist-fail-${chatId}` },
              );
            },
          });

          if (!persistResult.success) {
            console.warn(
              `Chat mode persist failed for chat ${chatId}, continuing with in-memory update`,
            );
          }
        }

        if (
          !isCancelled &&
          !restoreAbortController.signal.aborted &&
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
          const cachedCandidateMode: ChatMode =
            cachedChat.chatMode ??
            getEffectiveDefaultChatMode(
              snapshottedSettings,
              snapshottedEnvVars,
              !snapshottedIsQuotaExceeded,
            );

          let cachedFallbackMode =
            snapshottedSettings.selectedChatMode ?? "build";
          if (
            !isChatModeAllowed(
              cachedFallbackMode,
              snapshottedSettings,
              snapshottedEnvVars,
              !snapshottedIsQuotaExceeded,
            )
          ) {
            cachedFallbackMode = "build";
          }

          const cachedResolvedMode = resolveAllowedChatMode({
            desiredMode: cachedCandidateMode,
            fallbackMode: cachedFallbackMode,
            settings: snapshottedSettings,
            envVars: snapshottedEnvVars,
            freeAgentQuotaAvailable: !snapshottedIsQuotaExceeded,
          });

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

        const fetchedCandidateMode: ChatMode =
          chat.chatMode ??
          getEffectiveDefaultChatMode(
            snapshottedSettings,
            snapshottedEnvVars,
            !snapshottedIsQuotaExceeded,
          );

        let fetchedFallbackMode =
          snapshottedSettings.selectedChatMode ?? "build";
        if (
          !isChatModeAllowed(
            fetchedFallbackMode,
            snapshottedSettings,
            snapshottedEnvVars,
            !snapshottedIsQuotaExceeded,
          )
        ) {
          fetchedFallbackMode = "build";
        }

        const fetchedResolvedMode = resolveAllowedChatMode({
          desiredMode: fetchedCandidateMode,
          fallbackMode: fetchedFallbackMode,
          settings: snapshottedSettings,
          envVars: snapshottedEnvVars,
          freeAgentQuotaAvailable: !snapshottedIsQuotaExceeded,
        });

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
  }, [chatId, appId, persistChatMode, queryClient, t, updateSettings]);

  return { isRestoringMode };
}
