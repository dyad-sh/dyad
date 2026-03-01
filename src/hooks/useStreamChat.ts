import { useCallback, useEffect } from "react";
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
  queuedMessagesByIdAtom,
  streamCompletedSuccessfullyByIdAtom,
  type QueuedMessageItem,
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
  shouldProcessQueue = false,
}: { hasChatId?: boolean; shouldProcessQueue?: boolean } = {}) {
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
  const [queuedMessagesById, setQueuedMessagesById] = useAtom(
    queuedMessagesByIdAtom,
  );
  const [streamCompletedSuccessfullyById, setStreamCompletedSuccessfullyById] =
    useAtom(streamCompletedSuccessfullyByIdAtom);

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
      // Reset the successful completion flag when starting a new stream
      setStreamCompletedSuccessfullyById((prev) => {
        const next = new Map(prev);
        next.set(chatId, false);
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
              // Only mark as successful if NOT cancelled - wasCancelled flag is set
              // by the backend when user cancels the stream
              if (!response.wasCancelled) {
                setStreamCompletedSuccessfullyById((prev) => {
                  const next = new Map(prev);
                  next.set(chatId, true);
                  return next;
                });
              }

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
                const appName = app?.name ?? "Coney";
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
      setStreamCompletedSuccessfullyById,
      checkProblems,
      selectedAppId,
      refetchUserBudget,
      settings,
      queryClient,
    ],
  );

  // Process first queued message when streaming ends successfully
  useEffect(() => {
    if (!chatId || !shouldProcessQueue) return;

    const queuedMessages = queuedMessagesById.get(chatId) ?? [];
    const completedSuccessfully =
      streamCompletedSuccessfullyById.get(chatId) ?? false;

    // Only process queue if we have confirmation that the stream completed successfully
    // This prevents race conditions where the queue might be processed during cancellation
    if (queuedMessages.length > 0 && completedSuccessfully) {
      // Clear the successful completion flag first to prevent loops
      setStreamCompletedSuccessfullyById((prev) => {
        const next = new Map(prev);
        next.set(chatId, false);
        return next;
      });

      // Get and remove the first message atomically by extracting it inside the setter
      // This prevents race conditions where the queue might be modified between
      // reading firstMessage and updating the queue
      let messageToSend: QueuedMessageItem | undefined;
      setQueuedMessagesById((prev) => {
        const next = new Map(prev);
        const current = prev.get(chatId) ?? [];
        const [first, ...remainingMessages] = current;
        messageToSend = first;
        if (remainingMessages.length > 0) {
          next.set(chatId, remainingMessages);
        } else {
          next.delete(chatId);
        }
        return next;
      });

      if (!messageToSend) return;

      posthog.capture("chat:submit", { chatMode: settings?.selectedChatMode });

      // Send the first message
      streamMessage({
        prompt: messageToSend.prompt,
        chatId,
        redo: false,
        attachments: messageToSend.attachments,
        selectedComponents: messageToSend.selectedComponents,
      });
    }
  }, [
    chatId,
    queuedMessagesById,
    streamCompletedSuccessfullyById,
    streamMessage,
    setQueuedMessagesById,
    setStreamCompletedSuccessfullyById,
    posthog,
    settings?.selectedChatMode,
    shouldProcessQueue,
  ]);

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
    // Multi-message queue support
    queuedMessages:
      hasChatId && chatId !== undefined
        ? (queuedMessagesById.get(chatId) ?? [])
        : [],
    queueMessage: (message: Omit<QueuedMessageItem, "id">): boolean => {
      if (chatId === undefined) return false;
      const newItem: QueuedMessageItem = {
        ...message,
        id: crypto.randomUUID(),
      };
      setQueuedMessagesById((prev) => {
        const next = new Map(prev);
        const existing = prev.get(chatId) ?? [];
        next.set(chatId, [...existing, newItem]);
        return next;
      });
      return true;
    },
    updateQueuedMessage: (
      id: string,
      updates: Partial<
        Pick<QueuedMessageItem, "prompt" | "attachments" | "selectedComponents">
      >,
    ) => {
      if (chatId === undefined) return;
      setQueuedMessagesById((prev) => {
        const next = new Map(prev);
        const existing = prev.get(chatId) ?? [];
        const updated = existing.map((msg) =>
          msg.id === id ? { ...msg, ...updates } : msg,
        );
        next.set(chatId, updated);
        return next;
      });
    },
    removeQueuedMessage: (id: string) => {
      if (chatId === undefined) return;
      setQueuedMessagesById((prev) => {
        const next = new Map(prev);
        const existing = prev.get(chatId) ?? [];
        const filtered = existing.filter((msg) => msg.id !== id);
        if (filtered.length > 0) {
          next.set(chatId, filtered);
        } else {
          next.delete(chatId);
        }
        return next;
      });
    },
    reorderQueuedMessages: (fromIndex: number, toIndex: number) => {
      if (chatId === undefined) return;
      setQueuedMessagesById((prev) => {
        const next = new Map(prev);
        const existing = [...(prev.get(chatId) ?? [])];
        if (
          fromIndex < 0 ||
          fromIndex >= existing.length ||
          toIndex < 0 ||
          toIndex >= existing.length
        ) {
          return prev;
        }
        const [removed] = existing.splice(fromIndex, 1);
        existing.splice(toIndex, 0, removed);
        next.set(chatId, existing);
        return next;
      });
    },
    clearAllQueuedMessages: () => {
      if (chatId === undefined) return;
      setQueuedMessagesById((prev) => {
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      });
    },
  };
}
