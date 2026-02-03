import { useCallback } from "react";
import type {
  ComponentSelection,
  FileAttachment,
  ChatAttachment,
} from "@/ipc/types";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  chatErrorByIdAtom,
  chatMessagesByIdAtom,
  chatStreamCountByIdAtom,
  isStreamingByIdAtom,
  recentStreamChatIdsAtom,
} from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import type { ChatResponseEnd, App } from "@/ipc/types";
import type { ChatSummary } from "@/lib/schemas";
import { useChats } from "./useChats";
import { useLoadApp } from "./useLoadApp";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useVersions } from "./useVersions";
import { showExtraFilesToast } from "@/lib/toast";
import { useSearch } from "@tanstack/react-router";
import { useRunApp } from "./useRunApp";
import { useCountTokens } from "./useCountTokens";
import { useUserBudgetInfo } from "./useUserBudgetInfo";
import { usePostHog } from "posthog-js/react";
import { useCheckProblems } from "./useCheckProblems";
import { useSettings } from "./useSettings";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function getRandomNumberId() {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

// Module-level set to track chatIds with active/pending streams
// This prevents race conditions when clicking rapidly before state updates
const pendingStreamChatIds = new Set<number>();

export function useStreamChat({
  hasChatId = true,
}: { hasChatId?: boolean } = {}) {
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const isStreamingById = useAtomValue(isStreamingByIdAtom);
  const setIsStreamingById = useSetAtom(isStreamingByIdAtom);
  const errorById = useAtomValue(chatErrorByIdAtom);
  const setErrorById = useSetAtom(chatErrorByIdAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const { invalidateChats } = useChats(selectedAppId);
  const { refreshApp } = useLoadApp(selectedAppId);

  const setStreamCountById = useSetAtom(chatStreamCountByIdAtom);
  const { refreshVersions } = useVersions(selectedAppId);
  const { refreshAppIframe } = useRunApp();
  const { refetchUserBudget } = useUserBudgetInfo();
  const { checkProblems } = useCheckProblems(selectedAppId);
  const { settings } = useSettings();
  const setRecentStreamChatIds = useSetAtom(recentStreamChatIdsAtom);
  const posthog = usePostHog();
  const queryClient = useQueryClient();
  let chatId: number | undefined;

  if (hasChatId) {
    const { id } = useSearch({ from: "/chat" });
    chatId = id;
  }
  const { invalidateTokenCount } = useCountTokens(chatId ?? null, "");

  const streamMessage = useCallback(
    async ({
      prompt,
      chatId,
      redo,
      attachments,
      selectedComponents,
      onSettled,
    }: {
      prompt: string;
      chatId: number;
      redo?: boolean;
      attachments?: FileAttachment[];
      selectedComponents?: ComponentSelection[];
      onSettled?: () => void;
    }) => {
      if (
        (!prompt.trim() && (!attachments || attachments.length === 0)) ||
        !chatId
      ) {
        return;
      }

      // Prevent duplicate streams - check module-level set to avoid race conditions
      if (pendingStreamChatIds.has(chatId)) {
        console.warn(
          `[CHAT] Ignoring duplicate stream request for chat ${chatId} - stream already in progress`,
        );
        // Call onSettled to allow callers to clean up their local loading state
        onSettled?.();
        return;
      }

      // Mark this chat as having a pending stream
      pendingStreamChatIds.add(chatId);

      setRecentStreamChatIds((prev) => {
        const next = new Set(prev);
        next.add(chatId);
        return next;
      });

      setErrorById((prev) => {
        const next = new Map(prev);
        next.set(chatId, null);
        return next;
      });
      setIsStreamingById((prev) => {
        const next = new Map(prev);
        next.set(chatId, true);
        return next;
      });

      // Convert FileAttachment[] (with File objects) to ChatAttachment[] (base64 encoded)
      let convertedAttachments: ChatAttachment[] | undefined;
      if (attachments && attachments.length > 0) {
        convertedAttachments = await Promise.all(
          attachments.map(
            (attachment) =>
              new Promise<ChatAttachment>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                  resolve({
                    name: attachment.file.name,
                    type: attachment.file.type,
                    data: reader.result as string,
                    attachmentType: attachment.type,
                  });
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(attachment.file);
              }),
          ),
        );
      }

      let hasIncrementedStreamCount = false;
      try {
        ipc.chatStream.start(
          {
            chatId,
            prompt,
            redo,
            attachments: convertedAttachments,
            selectedComponents: selectedComponents ?? [],
          },
          {
            onChunk: ({ messages: updatedMessages }) => {
              if (!hasIncrementedStreamCount) {
                setStreamCountById((prev) => {
                  const next = new Map(prev);
                  next.set(chatId, (prev.get(chatId) ?? 0) + 1);
                  return next;
                });
                hasIncrementedStreamCount = true;
              }

              setMessagesById((prev) => {
                const next = new Map(prev);
                next.set(chatId, updatedMessages);
                return next;
              });
            },
            onEnd: (response: ChatResponseEnd) => {
              // Remove from pending set now that stream is complete
              pendingStreamChatIds.delete(chatId);

              // Show native notification if enabled and window is not focused
              // Fire-and-forget to avoid blocking UI updates
              const notificationsEnabled =
                settings?.enableChatCompletionNotifications === true;
              if (
                notificationsEnabled &&
                Notification.permission === "granted" &&
                !document.hasFocus()
              ) {
                const app = queryClient.getQueryData<App | null>(
                  queryKeys.apps.detail({ appId: selectedAppId }),
                );
                const chats = queryClient.getQueryData<ChatSummary[]>(
                  queryKeys.chats.list({ appId: selectedAppId }),
                );
                const chat = chats?.find((c) => c.id === chatId);
                const appName = app?.name ?? "Dyad";
                const rawTitle = response.chatSummary ?? chat?.title;
                const body = rawTitle
                  ? rawTitle.length > 80
                    ? rawTitle.slice(0, 80) + "…"
                    : rawTitle
                  : "Chat response completed";
                new Notification(appName, {
                  body,
                });
              }

              if (response.updatedFiles) {
                if (settings?.autoExpandPreviewPanel) {
                  setIsPreviewOpen(true);
                }
                refreshAppIframe();
                if (settings?.enableAutoFixProblems) {
                  checkProblems();
                }
              }
              if (response.extraFiles) {
                showExtraFilesToast({
                  files: response.extraFiles,
                  error: response.extraFilesError,
                  posthog,
                });
              }
              // Use queryClient directly with the chatId parameter to avoid stale closure issues
              queryClient.invalidateQueries({ queryKey: ["proposal", chatId] });

              refetchUserBudget();

              // Invalidate free agent quota to update the UI after message
              queryClient.invalidateQueries({
                queryKey: queryKeys.freeAgentQuota.status,
              });

              // Keep the same as below
              setIsStreamingById((prev) => {
                const next = new Map(prev);
                next.set(chatId, false);
                return next;
              });
              // Use queryClient directly with the chatId parameter to avoid stale closure issues
              queryClient.invalidateQueries({
                queryKey: queryKeys.proposals.detail({ chatId }),
              });
              invalidateChats();
              refreshApp();
              refreshVersions();
              invalidateTokenCount();
              onSettled?.();
            },
            onError: ({ error: errorMessage }) => {
              // Remove from pending set now that stream ended with error
              pendingStreamChatIds.delete(chatId);

              console.error(`[CHAT] Stream error for ${chatId}:`, errorMessage);
              setErrorById((prev) => {
                const next = new Map(prev);
                next.set(chatId, errorMessage);
                return next;
              });

              // Invalidate free agent quota to update the UI after error
              // (the server may have refunded the quota)
              queryClient.invalidateQueries({
                queryKey: queryKeys.freeAgentQuota.status,
              });

              // Keep the same as above
              setIsStreamingById((prev) => {
                const next = new Map(prev);
                next.set(chatId, false);
                return next;
              });
              invalidateChats();
              refreshApp();
              refreshVersions();
              invalidateTokenCount();
              onSettled?.();
            },
          },
        );
      } catch (error) {
        // Remove from pending set on exception
        pendingStreamChatIds.delete(chatId);

        console.error("[CHAT] Exception during streaming setup:", error);
        setIsStreamingById((prev) => {
          const next = new Map(prev);
          if (chatId) next.set(chatId, false);
          return next;
        });
        setErrorById((prev) => {
          const next = new Map(prev);
          if (chatId)
            next.set(
              chatId,
              error instanceof Error ? error.message : String(error),
            );
          return next;
        });
        onSettled?.();
      }
    },
    [
      setMessagesById,
      setIsStreamingById,
      setIsPreviewOpen,
      checkProblems,
      selectedAppId,
      refetchUserBudget,
      settings,
      queryClient,
    ],
  );

  return {
    streamMessage,
    isStreaming:
      hasChatId && chatId !== undefined
        ? (isStreamingById.get(chatId) ?? false)
        : false,
    error:
      hasChatId && chatId !== undefined
        ? (errorById.get(chatId) ?? null)
        : null,
    setError: (value: string | null) =>
      setErrorById((prev) => {
        const next = new Map(prev);
        if (chatId !== undefined) next.set(chatId, value);
        return next;
      }),
    setIsStreaming: (value: boolean) =>
      setIsStreamingById((prev) => {
        const next = new Map(prev);
        if (chatId !== undefined) next.set(chatId, value);
        return next;
      }),
  };
}
