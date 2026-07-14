import { useCallback, useRef } from "react";
import type { ComponentSelection, FileAttachment } from "@/ipc/types";
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
  publishChatCompletionEventAtom,
  type QueuedMessageItem,
} from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { pendingScreenshotAppIdAtom } from "@/atoms/previewAtoms";
import type { ChatResponseEnd, Chat } from "@/ipc/types";
import type { SubagentThreadSummary } from "@/ipc/types/agent";
import { useChats } from "./useChats";
import { useLoadApp } from "./useLoadApp";
import { applyStreamingPatch } from "@/lib/applyStreamingPatch";
import {
  applyPreviewChunk,
  clearPreviewForChat,
} from "@/lib/streamingPreviewSync";
import {
  triggerResync,
  syncChatFromDb,
  mergeResyncMessages,
} from "@/lib/resyncChat";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { setPackageManagerWarningForAppAtom } from "@/atoms/previewRuntimeAtoms";
import { useVersions } from "./useVersions";
import { showError, showExtraFilesToast, showWarning } from "@/lib/toast";
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
import { resolveAppIdForChat } from "@/lib/chatUtils";
import { PNPM_MINIMUM_RELEASE_AGE_WARNING_PREFIX } from "@/shared/packageManagerWarnings";
import {
  shouldShowPnpmMinimumReleaseAgeWarning,
  type ChatMode,
} from "@/lib/schemas";
import { isFreeProModel } from "@/lib/freeProModel";
import { validateChatAttachmentFiles } from "@/shared/chatAttachmentLimits";
import { convertFileAttachmentsToChatAttachments } from "@/lib/chatAttachmentConversion";

export function getRandomNumberId() {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

// Module-level set to track chatIds with active/pending streams
// This prevents race conditions when clicking rapidly before state updates
const pendingStreamChatIds = new Set<number>();
const backgroundAutoReviewChatIds = new Set<number>();

const ACTIVE_REVIEW_STATUSES = new Set<SubagentThreadSummary["status"]>([
  "queued",
  "running",
  "waiting_for_writer",
]);

export function shouldStartBackgroundAutoReview(params: {
  updatedFiles: boolean;
  enableAutoReview: boolean;
  hasQueuedMessages: boolean;
  suppressAutoReview: boolean;
}): boolean {
  return (
    params.updatedFiles &&
    params.enableAutoReview &&
    !params.hasQueuedMessages &&
    !params.suppressAutoReview
  );
}

async function waitForReview(
  chatId: number,
  initial: SubagentThreadSummary,
): Promise<SubagentThreadSummary> {
  let review = initial;
  while (ACTIVE_REVIEW_STATUSES.has(review.status)) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const threads = await ipc.agent.listSubagents({ chatId });
    const updated = threads.find((thread) => thread.id === review.id);
    if (!updated) return review;
    review = updated;
  }
  return review;
}

export async function runBackgroundAutoReview(params: {
  chatId: number;
  sourceMessageId: number;
  autoFix: boolean;
  streamFix: (prompt: string) => Promise<boolean>;
}): Promise<void> {
  if (backgroundAutoReviewChatIds.has(params.chatId)) return;
  backgroundAutoReviewChatIds.add(params.chatId);
  try {
    const started = await ipc.agent.startAutoReview({
      chatId: params.chatId,
      sourceMessageId: params.sourceMessageId,
    });
    const completed = await waitForReview(params.chatId, started);
    if (
      !params.autoFix ||
      completed.status !== "completed" ||
      Number(completed.result?.findingCount ?? 0) === 0
    ) {
      return;
    }
    const { prompt } = await ipc.agent.fixReviewFindings({
      chatId: params.chatId,
      threadId: completed.id,
    });
    const remediated = await params.streamFix(prompt);
    if (!remediated) {
      await ipc.agent.skipReviewAutoFix({
        chatId: params.chatId,
        threadId: completed.id,
      });
      return;
    }
    await ipc.agent.runAutoReviewBarrier({
      chatId: params.chatId,
      verification: true,
    });
  } finally {
    backgroundAutoReviewChatIds.delete(params.chatId);
  }
}

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
  const publishChatCompletionEvent = useSetAtom(publishChatCompletionEventAtom);
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
  const setPackageManagerWarning = useSetAtom(
    setPackageManagerWarningForAppAtom,
  );
  let chatId: number | undefined;

  const showWarningMessage = useCallback(
    (warningMessage: string, warningAppId: number | null) => {
      if (warningMessage.startsWith(PNPM_MINIMUM_RELEASE_AGE_WARNING_PREFIX)) {
        if (!shouldShowPnpmMinimumReleaseAgeWarning(settings)) {
          return;
        }

        if (warningAppId !== null) {
          setPackageManagerWarning({
            appId: warningAppId,
            warning: { kind: "release-age", message: warningMessage },
          });
        } else {
          showWarning(warningMessage);
        }
        return;
      }

      showWarning(warningMessage);
    },
    [
      setPackageManagerWarning,
      settings,
      settings?.enablePnpmMinimumReleaseAgeWarning,
      settings?.hidePnpmMinimumReleaseAgeWarning,
    ],
  );

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
      suppressAutoReview = false,
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
      /** Internal turns such as review remediation must not review themselves. */
      suppressAutoReview?: boolean;
    }) => {
      if (
        (!prompt.trim() && (!attachments || attachments.length === 0)) ||
        !chatId
      ) {
        return;
      }

      const attachmentValidation = validateChatAttachmentFiles(
        (attachments ?? []).map(({ file }) => file),
      );
      if (!attachmentValidation.ok) {
        showError(attachmentValidation.message);
        onSettled?.({ success: false });
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

      let hasIncrementedStreamCount = false;
      // The mode this turn actually ran in, as resolved by the main process
      // (sent as a dedicated chunk at the start of every stream). Chat mode
      // is stored per-chat, so `settings.selectedChatMode` alone can't tell
      // us how the turn ran.
      let effectiveChatModeForTurn: ChatMode | undefined;
      const shouldInvalidateFreeModelQuota = isFreeProModel(
        settings?.selectedModel,
      );
      const finalizeStream = (chatId: number) => {
        pendingStreamChatIds.delete(chatId);
        latestChunkByChatId.delete(chatId);
        cancelAckTimer(chatId);
        clearPreviewForChat(setStreamingPreviewByChatId, chatId);
      };

      try {
        // Convert one file at a time so FileReader does not hold every source
        // buffer concurrently alongside all encoded strings.
        const convertedAttachments =
          attachments && attachments.length > 0
            ? await convertFileAttachmentsToChatAttachments(attachments)
            : undefined;

        // Resolve the target app from the chat itself when the caller didn't
        // pass one. Falling back to `selectedAppId` is wrong for background
        // queue processing, where the user may have switched to a different
        // app while a queued message streams for the original chat.
        const resolvedAppIdFromChat =
          appId === undefined
            ? await resolveAppIdForChat(chatId, queryClient)
            : null;
        const targetAppId =
          appId ?? resolvedAppIdFromChat ?? selectedAppId ?? null;

        const cachedChat =
          requestedChatMode === null
            ? undefined
            : queryClient.getQueryData<Chat>(
                queryKeys.chats.detail({ chatId }),
              );

        if (shouldInvalidateFreeModelQuota) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.freeModelQuota.status,
          });
        }

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
                effectiveChatModeForTurn = effectiveChatMode;
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

              applyPreviewChunk(
                setStreamingPreviewByChatId,
                chatId,
                streamingPreview,
              );

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
              finalizeStream(chatId);
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
                  publishChatCompletionEvent({
                    chatId,
                    title: response.chatSummary,
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
                  // Skip the automatic problems refresh for local-agent turns:
                  // the agent runs its own type checks (run_type_checks), so a
                  // renderer-side re-scan would duplicate the same full
                  // TypeScript build moments later. The Problems panel is
                  // refreshed manually in agent mode.
                  // The effective-mode chunk always arrives before onEnd, so
                  // the fallbacks are defensive only; prefer the per-chat
                  // stored mode over the global selection (chat mode is
                  // per-chat, see effectiveChatModeForTurn above).
                  const ranAsLocalAgent =
                    (effectiveChatModeForTurn ??
                      queryClient.getQueryData<Chat>(
                        queryKeys.chats.detail({ chatId }),
                      )?.chatMode ??
                      settings?.selectedChatMode) === "local-agent";
                  if (
                    settings?.enableAutoFixProblems &&
                    targetAppId &&
                    !ranAsLocalAgent
                  ) {
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
                  showWarningMessage(warningMessage, targetAppId);
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
                if (shouldInvalidateFreeModelQuota) {
                  queryClient.invalidateQueries({
                    queryKey: queryKeys.freeModelQuota.status,
                  });
                }

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
                // Refresh the uncommitted changes banner immediately rather
                // than waiting for its 5s poll, so it reflects the changes
                // made by this stream as soon as it ends.
                queryClient.invalidateQueries({
                  queryKey: queryKeys.uncommittedFiles.byApp({
                    appId: targetAppId,
                  }),
                });
                if (
                  shouldStartBackgroundAutoReview({
                    updatedFiles: response.updatedFiles === true,
                    enableAutoReview: settings?.enableAutoReview === true,
                    hasQueuedMessages:
                      (store.get(queuedMessagesByIdAtom).get(chatId)?.length ??
                        0) > 0,
                    suppressAutoReview,
                  })
                ) {
                  void ipc.chat
                    .getChat(chatId)
                    .then((latestChat) => {
                      const latestAssistant = [...latestChat.messages]
                        .reverse()
                        .find((message) => message.role === "assistant");
                      if (latestAssistant) {
                        return runBackgroundAutoReview({
                          chatId,
                          sourceMessageId: latestAssistant.id,
                          autoFix: settings?.autoFixReviewIssues === true,
                          streamFix: (fixPrompt) =>
                            new Promise<boolean>((resolve) => {
                              const startStream = streamMessageRef.current;
                              if (!startStream) {
                                resolve(false);
                                return;
                              }
                              startStream({
                                prompt: fixPrompt,
                                chatId,
                                redo: false,
                                requestedChatMode: "local-agent",
                                suppressAutoReview: true,
                                onSettled: ({ success }) => resolve(success),
                              });
                            }),
                        });
                      }
                    })
                    .catch(() => {
                      // Auto-review failures stay non-blocking when no message
                      // is queued. The Agent team card surfaces explicit runs.
                    });
                }
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
              finalizeStream(chatId);

              for (const warningMessage of warningMessages ?? []) {
                showWarningMessage(warningMessage, targetAppId);
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
              if (shouldInvalidateFreeModelQuota) {
                queryClient.invalidateQueries({
                  queryKey: queryKeys.freeModelQuota.status,
                });
              }

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
        finalizeStream(chatId);

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
      showWarningMessage,
      queryClient,
      store,
    ],
  );
  const streamMessageRef = useRef<typeof streamMessage | null>(null);
  streamMessageRef.current = streamMessage;

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
