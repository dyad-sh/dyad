import { useCallback } from "react";
import type {
  ComponentSelection,
  FileAttachment,
  ChatAttachment,
} from "@/ipc/types";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  chatErrorByIdAtom,
  chatMessagesByIdAtom,
  chatStreamCountByIdAtom,
  isStreamingByIdAtom,
  recentStreamChatIdsAtom,
  queuedMessagesByIdAtom,
  streamCompletedSuccessfullyByIdAtom,
  streamingPreviewByChatIdAtom,
  queuePausedByIdAtom,
  type QueuedMessageItem,
} from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { pendingScreenshotAppIdAtom } from "@/atoms/previewAtoms";
import type { ChatResponseEnd, App, Chat } from "@/ipc/types";
import type { ChatSummary } from "@/lib/schemas";
import { useChats } from "./useChats";
import { useLoadApp } from "./useLoadApp";
import { applyStreamingPatch } from "@/lib/applyStreamingPatch";
import {
  triggerResync,
  syncChatFromDb,
  mergeResyncMessages,
} from "@/lib/resyncChat";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useVersions } from "./useVersions";
import { showExtraFilesToast, showWarning } from "@/lib/toast";
import { useSearch } from "@tanstack/react-router";
import { useRunApp } from "./useRunApp";
import { useCountTokens } from "./useCountTokens";
import { useUserBudgetInfo } from "./useUserBudgetInfo";
import { usePostHog } from "posthog-js/react";

import { useSettings } from "./useSettings";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { applyCancellationNoticeToLastAssistantMessage } from "@/shared/chatCancellation";
import { handleEffectiveChatModeChunk } from "@/lib/chatModeStream";

export function getRandomNumberId() {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

// Module-level set to track chatIds with active/pending streams
// This prevents race conditions when clicking rapidly before state updates
const pendingStreamChatIds = new Set<number>();

// Throttled ack scheduler for the canned test stream's ack-based
// backpressure. Stores the highest chunkSeq received per chatId; at most
// one ack per ACK_THROTTLE_MS is sent per chatId, carrying the latest
// received seq. Real LLM streams omit chunkSeq, so the scheduler is never
// armed for them.
const ACK_THROTTLE_MS = 250;
const latestChunkByChatId = new Map<number, number>();
const ackTimerByChatId = new Map<number, ReturnType<typeof setTimeout>>();

function scheduleThrottledAck(chatId: number): void {
  if (ackTimerByChatId.has(chatId)) return;
  const timer = setTimeout(() => {
    ackTimerByChatId.delete(chatId);
    const seq = latestChunkByChatId.get(chatId);
    if (seq === undefined) return;
    void ipc.chat.responseAck({ chatId, lastSeq: seq }).catch(() => {
      // Ignore ack failures; main has no retry path and acks are
      // advisory under throttling.
    });
  }, ACK_THROTTLE_MS);
  ackTimerByChatId.set(chatId, timer);
}

function cancelAckTimer(chatId: number): void {
  const timer = ackTimerByChatId.get(chatId);
  if (timer !== undefined) {
    clearTimeout(timer);
    ackTimerByChatId.delete(chatId);
  }
}

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

  const store = useStore();
  const setStreamCountById = useSetAtom(chatStreamCountByIdAtom);
  const { refreshVersions } = useVersions(selectedAppId);
  const { refreshAppIframe } = useRunApp();
  const { refetchUserBudget } = useUserBudgetInfo();
  const setPendingScreenshotAppId = useSetAtom(pendingScreenshotAppIdAtom);
  const { settings } = useSettings();
  const setRecentStreamChatIds = useSetAtom(recentStreamChatIdsAtom);
  const [queuedMessagesById, setQueuedMessagesById] = useAtom(
    queuedMessagesByIdAtom,
  );
  const setStreamCompletedSuccessfullyById = useSetAtom(
    streamCompletedSuccessfullyByIdAtom,
  );
  const setStreamingPreviewByChatId = useSetAtom(streamingPreviewByChatIdAtom);
  const queuePausedById = useAtomValue(queuePausedByIdAtom);
  const setQueuePausedById = useSetAtom(queuePausedByIdAtom);

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
      appId,
      redo,
      attachments,
      selectedComponents,
      requestedChatMode,
      onSettled,
    }: {
      prompt: string;
      chatId: number;
      appId?: number;
      redo?: boolean;
      attachments?: FileAttachment[];
      selectedComponents?: ComponentSelection[];
      requestedChatMode?: Chat["chatMode"] | null;
      onSettled?: (result: {
        success: boolean;
        pausedByStepLimit?: boolean;
      }) => void;
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
        onSettled?.({ success: false });
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
      // Resolve the target app from the chat itself when the caller didn't
      // pass one. Falling back to `selectedAppId` is wrong for background
      // queue processing, where the user may have switched to a different
      // app while a queued message streams for the original chat.
      let resolvedAppIdFromChat: number | null = null;
      if (appId === undefined) {
        // queryKeys.chats.all matches detail/search caches too (non-array data),
        // so guard against non-array entries before calling .find.
        const chatsCaches = queryClient.getQueriesData<ChatSummary[]>({
          queryKey: queryKeys.chats.all,
        });
        for (const [, cachedChats] of chatsCaches) {
          if (!Array.isArray(cachedChats)) continue;
          const found = cachedChats.find((c) => c.id === chatId);
          if (found) {
            resolvedAppIdFromChat = found.appId;
            break;
          }
        }
      }
      const targetAppId =
        appId ?? resolvedAppIdFromChat ?? selectedAppId ?? null;

      const clearStreamingPreviewForChat = (chatId: number) => {
        setStreamingPreviewByChatId((prev) => {
          if (!prev.has(chatId)) return prev;
          const next = new Map(prev);
          next.delete(chatId);
          return next;
        });
      };

      try {
        const cachedChat =
          requestedChatMode === null
            ? undefined
            : queryClient.getQueryData<Chat>(
                queryKeys.chats.detail({ chatId }),
              );

        ipc.chatStream.start(
          {
            chatId,
            prompt,
            redo,
            attachments: convertedAttachments,
            selectedComponents: selectedComponents ?? [],
            requestedChatMode:
              requestedChatMode === null
                ? undefined
                : (requestedChatMode ?? cachedChat?.chatMode ?? undefined),
          },
          {
            onChunk: ({
              messages: updatedMessages,
              streamingMessageId,
              streamingPatch,
              streamingPreview,
              chunkSeq,
              effectiveChatMode,
              chatModeFallbackReason,
            }) => {
              if (
                handleEffectiveChatModeChunk(
                  { effectiveChatMode, chatModeFallbackReason },
                  settings,
                  chatId,
                )
              ) {
                if (chatModeFallbackReason) {
                  queryClient.invalidateQueries({
                    queryKey: queryKeys.chats.detail({ chatId }),
                  });
                }
                return;
              }

              if (!hasIncrementedStreamCount) {
                setStreamCountById((prev) => {
                  const next = new Map(prev);
                  next.set(chatId, (prev.get(chatId) ?? 0) + 1);
                  return next;
                });
                hasIncrementedStreamCount = true;
              }

              if (streamingPreview) {
                // Sidecar tool-input XML overlay. Doesn't touch
                // message.content. Empty content clears the overlay (server
                // sends an empty preview when the tool's finalized XML is
                // committed into fullResponse via onXmlComplete).
                const { content } = streamingPreview;
                setStreamingPreviewByChatId((prev) => {
                  const existing = prev.get(chatId);
                  if (content === "") {
                    if (existing === undefined) return prev;
                    const next = new Map(prev);
                    next.delete(chatId);
                    return next;
                  }
                  if (existing === content) return prev;
                  const next = new Map(prev);
                  next.set(chatId, content);
                  return next;
                });
              }

              if (updatedMessages) {
                // Full messages update (initial load, post-compaction, etc.)
                setMessagesById((prev) => {
                  const next = new Map(prev);
                  next.set(chatId, updatedMessages);
                  return next;
                });
              } else if (
                streamingMessageId !== undefined &&
                streamingPatch !== undefined
              ) {
                const applied = applyStreamingPatch(
                  setMessagesById,
                  chatId,
                  streamingMessageId,
                  streamingPatch,
                );
                if (!applied) {
                  triggerResync(chatId, setMessagesById, store);
                }
              }

              // Ack-based backpressure for the canned test stream. Real
              // LLM streams omit chunkSeq, so this is a no-op for them.
              // Coalesce many incoming chunks into a single ack fired on a
              // fixed throttle interval (ACK_THROTTLE_MS).
              if (chunkSeq !== undefined) {
                const prev = latestChunkByChatId.get(chatId) ?? 0;
                if (chunkSeq > prev) {
                  latestChunkByChatId.set(chatId, chunkSeq);
                }
                scheduleThrottledAck(chatId);
              }
            },
            onEnd: (response: ChatResponseEnd) => {
              pendingStreamChatIds.delete(chatId);
              latestChunkByChatId.delete(chatId);
              cancelAckTimer(chatId);
              clearStreamingPreviewForChat(chatId);
              void (async () => {
                // Only mark as successful if NOT cancelled - wasCancelled flag is set
                // by the backend when user cancels the stream
                if (response.wasCancelled) {
                  setMessagesById((prev) => {
                    const existingMessages = prev.get(chatId);
                    if (!existingMessages) return prev;

                    const updatedMessages =
                      applyCancellationNoticeToLastAssistantMessage(
                        existingMessages,
                      );
                    if (updatedMessages === existingMessages) {
                      return prev;
                    }

                    const next = new Map(prev);
                    next.set(chatId, updatedMessages);
                    return next;
                  });
                }

                if (response.pausePromptQueue) {
                  setQueuePausedById((prev) => {
                    const next = new Map(prev);
                    next.set(chatId, true);
                    return next;
                  });
                }

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
                  settings?.enableChatEventNotifications === true;
                if (
                  notificationsEnabled &&
                  Notification.permission === "granted" &&
                  !document.hasFocus()
                ) {
                  const app = queryClient.getQueryData<App | null>(
                    queryKeys.apps.detail({ appId: targetAppId ?? null }),
                  );
                  const chats = queryClient.getQueryData<ChatSummary[]>(
                    queryKeys.chats.list({ appId: targetAppId ?? null }),
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
                  if (targetAppId) {
                    setPendingScreenshotAppId(targetAppId);
                  }
                  if (settings?.enableAutoFixProblems && targetAppId) {
                    queryClient.invalidateQueries({
                      queryKey: queryKeys.problems.byApp({
                        appId: targetAppId,
                      }),
                    });
                  }
                }
                if (response.extraFiles) {
                  showExtraFilesToast({
                    files: response.extraFiles,
                    error: response.extraFilesError,
                    posthog,
                  });
                }
                for (const warningMessage of response.warningMessages ?? []) {
                  showWarning(warningMessage);
                }
                // Use queryClient directly with the chatId parameter to avoid stale closure issues
                queryClient.invalidateQueries({
                  queryKey: ["proposal", chatId],
                });

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
                if (!response.wasCancelled) {
                  // Re-fetch messages to pick up server-assigned fields (e.g. commitHash)
                  // that may only be finalized at stream completion.
                  try {
                    const latestChat = await ipc.chat.getChat(chatId);
                    queryClient.setQueryData(
                      queryKeys.chats.detail({ chatId }),
                      latestChat,
                    );
                    // Guard against a racing new stream that started after
                    // setIsStreamingById(false) above.
                    if (!store.get(isStreamingByIdAtom).get(chatId)) {
                      setMessagesById((prev) => {
                        const currentMessages = prev.get(chatId);
                        if (!currentMessages) {
                          const next = new Map(prev);
                          next.set(chatId, latestChat.messages);
                          return next;
                        }
                        if (currentMessages.length > latestChat.messages.length)
                          return prev;
                        const merged = mergeResyncMessages(
                          latestChat.messages,
                          currentMessages,
                        );
                        const next = new Map(prev);
                        next.set(chatId, merged);
                        return next;
                      });
                    }
                  } catch (error) {
                    console.warn(
                      `[CHAT] Failed to refresh latest chat for ${chatId}:`,
                      error,
                    );
                  }
                }
                invalidateChats();
                refreshApp();
                refreshVersions();
                invalidateTokenCount();
                onSettled?.({
                  success: true,
                  pausedByStepLimit: response.pausePromptQueue === true,
                });
              })().catch((error) => {
                console.error(
                  `[CHAT] Failed to finalize stream for ${chatId}:`,
                  error,
                );
                setIsStreamingById((prev) => {
                  const next = new Map(prev);
                  next.set(chatId, false);
                  return next;
                });
                onSettled?.({ success: false });
              });
            },
            onError: ({ error: errorMessage, warningMessages }) => {
              // Remove from pending set now that stream ended with error
              pendingStreamChatIds.delete(chatId);
              latestChunkByChatId.delete(chatId);
              cancelAckTimer(chatId);
              clearStreamingPreviewForChat(chatId);

              for (const warningMessage of warningMessages ?? []) {
                showWarning(warningMessage);
              }
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
              syncChatFromDb(chatId, setMessagesById, "[CHAT] onError", store);
              invalidateChats();
              refreshApp();
              refreshVersions();
              invalidateTokenCount();
              onSettled?.({ success: false });
            },
          },
        );
      } catch (error) {
        // Remove from pending set on exception
        pendingStreamChatIds.delete(chatId);
        latestChunkByChatId.delete(chatId);
        cancelAckTimer(chatId);
        clearStreamingPreviewForChat(chatId);

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
        onSettled?.({ success: false });
      }
    },
    [
      setMessagesById,
      setIsStreamingById,
      setIsPreviewOpen,
      setStreamCompletedSuccessfullyById,
      setQueuePausedById,
      setStreamingPreviewByChatId,
      selectedAppId,
      refetchUserBudget,
      settings,
      queryClient,
      store,
    ],
  );

  // Memoize queue management functions to prevent unnecessary re-renders
  // in components that depend on these functions (e.g., restore effect)
  const queueMessage = useCallback(
    (message: Omit<QueuedMessageItem, "id">): boolean => {
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
    [chatId, setQueuedMessagesById],
  );

  const updateQueuedMessage = useCallback(
    (
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
    [chatId, setQueuedMessagesById],
  );

  const removeQueuedMessage = useCallback(
    (id: string) => {
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
    [chatId, setQueuedMessagesById],
  );

  const reorderQueuedMessages = useCallback(
    (fromIndex: number, toIndex: number) => {
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
    [chatId, setQueuedMessagesById],
  );

  const clearAllQueuedMessages = useCallback(() => {
    if (chatId === undefined) return;
    setQueuedMessagesById((prev) => {
      const next = new Map(prev);
      next.delete(chatId);
      return next;
    });
  }, [chatId, setQueuedMessagesById]);

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
    queueMessage,
    updateQueuedMessage,
    removeQueuedMessage,
    reorderQueuedMessages,
    clearAllQueuedMessages,
    isPaused:
      hasChatId && chatId !== undefined
        ? (queuePausedById.get(chatId) ?? false)
        : false,
    pauseQueue: useCallback(() => {
      if (chatId === undefined) return;
      setQueuePausedById((prev) => {
        const next = new Map(prev);
        next.set(chatId, true);
        return next;
      });
    }, [chatId, setQueuePausedById]),
    clearPauseOnly: useCallback(() => {
      if (chatId === undefined) return;
      setQueuePausedById((prev) => {
        const next = new Map(prev);
        next.set(chatId, false);
        return next;
      });
    }, [chatId, setQueuePausedById]),
    resumeQueue: useCallback(() => {
      if (chatId === undefined) return;
      setQueuePausedById((prev) => {
        const next = new Map(prev);
        next.set(chatId, false);
        return next;
      });
      // Signal the queue processor if we're not currently streaming
      if (!pendingStreamChatIds.has(chatId)) {
        setStreamCompletedSuccessfullyById((prev) => {
          const next = new Map(prev);
          next.set(chatId, true);
          return next;
        });
      }
    }, [chatId, setQueuePausedById, setStreamCompletedSuccessfullyById]),
    clearCompletionFlag: useCallback(() => {
      if (chatId === undefined) return;
      setStreamCompletedSuccessfullyById((prev) => {
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      });
    }, [chatId, setStreamCompletedSuccessfullyById]),
  };
}
