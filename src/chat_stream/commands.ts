import type { QueryClient } from "@tanstack/react-query";
import type { createStore } from "jotai";
import type { PostHog } from "posthog-js";

import {
  chatErrorByIdAtom,
  chatMessagesByIdAtom,
  chatStreamCountByIdAtom,
  publishChatCompletionEventAtom,
  queuePausedByIdAtom,
  queuedMessagesByIdAtom,
  streamingPreviewByChatIdAtom,
  isStreamingByIdAtom,
  type QueuedMessageItem,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { pendingScreenshotAppIdsAtom } from "@/atoms/previewAtoms";
import { bumpPreviewReloadTokenForAppAtom } from "@/atoms/previewRuntimeAtoms";
import { setPackageManagerWarningForAppAtom } from "@/atoms/previewRuntimeAtoms";
import { ipc } from "@/ipc/types";
import type { Chat, ChatResponseEnd, Message } from "@/ipc/types";
import { applyStreamingPatch } from "@/lib/applyStreamingPatch";
import { convertFileAttachmentsToChatAttachments } from "@/lib/chatAttachmentConversion";
import { handleEffectiveChatModeChunk } from "@/lib/chatModeStream";
import { resolveAppIdForChat } from "@/lib/chatUtils";
import { isFreeProModel } from "@/lib/freeProModel";
import { queryKeys } from "@/lib/queryKeys";
import {
  mergeResyncMessages,
  syncChatFromDb,
  triggerResync,
} from "@/lib/resyncChat";
import type { UserSettings } from "@/lib/schemas";
import { shouldShowPnpmMinimumReleaseAgeWarning } from "@/lib/schemas";
import {
  applyPreviewChunk,
  clearPreviewForChat,
} from "@/lib/streamingPreviewSync";
import { showExtraFilesToast, showWarning } from "@/lib/toast";
import { applyCancellationNoticeToLastAssistantMessage } from "@/shared/chatCancellation";
import { PNPM_MINIMUM_RELEASE_AGE_WARNING_PREFIX } from "@/shared/packageManagerWarnings";

import type { StreamEvent, StreamRequest, StreamState } from "./state";
import { isStreamActive } from "./transition";

type JotaiStore = ReturnType<typeof createStore>;

/**
 * Side-effect boundary for the chat stream machine. The controller executes
 * the pure `StreamCommand`s returned by `transition` through this interface;
 * tests substitute a fake.
 */
export interface ChatStreamCommands {
  /** Convert attachments and invoke `chat:stream`; stream events are emitted back via `emit`. */
  startStream(args: {
    chatId: number;
    streamId: number;
    request: StreamRequest;
    emit: (event: StreamEvent) => void;
  }): Promise<void>;
  /** Append a submission to the per-chat prompt queue. */
  enqueueMessage(args: { chatId: number; request: StreamRequest }): void;
  /** Ask the main process to abort the active stream. */
  requestAbort(args: { chatId: number }): void;
  /** Release renderer-owned stream transport state without aborting main. */
  releaseTransport(args: { chatId: number; streamId: number }): void;
  /** Run all end-of-stream side effects (throws => finalize-complete { ok: false }). */
  runEndSideEffects(args: {
    chatId: number;
    streamId: number;
    request: StreamRequest;
    targetAppId: number | null;
    response: ChatResponseEnd;
  }): Promise<void>;
  /** Run all stream-error side effects. */
  runErrorSideEffects(args: {
    chatId: number;
    streamId: number;
    request: StreamRequest;
    targetAppId: number | null;
    error: string;
    warningMessages?: string[];
  }): void;
  /** Pop the next queued message (unless paused/empty) and re-submit it via `emit`. */
  dispatchNextQueued(args: {
    chatId: number;
    emit: (event: StreamEvent) => void;
  }): void;
  /** Mirror machine state into the legacy `isStreamingByIdAtom` projection (single writer). */
  syncProjection(args: { chatId: number; state: StreamState }): void;
}

export interface ChatStreamRuntimeDeps {
  store: JotaiStore;
  queryClient: QueryClient;
  getSettings: () => UserSettings | null | undefined;
  getPosthog: () => PostHog | null;
}

// =============================================================================
// Ack-based backpressure for the canned test stream
// =============================================================================

// Throttled ack scheduler for the canned test stream's ack-based backpressure.
// Stores the highest chunkSeq received per chatId; at most one ack per
// ACK_THROTTLE_MS is sent per chatId, carrying the latest received seq. Real
// LLM streams omit chunkSeq, so the scheduler is never armed for them.
const ACK_THROTTLE_MS = 250;

// =============================================================================
// Shared helpers
// =============================================================================

type MessagesUpdater = (prev: Map<number, Message[]>) => Map<number, Message[]>;

function makeSetMessagesById(store: JotaiStore) {
  return (update: MessagesUpdater) => store.set(chatMessagesByIdAtom, update);
}

function invalidatePostStreamQueries(
  queryClient: QueryClient,
  targetAppId: number | null,
): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
  if (targetAppId !== null) {
    queryClient.invalidateQueries({
      queryKey: queryKeys.apps.detail({ appId: targetAppId }),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.versions.list({ appId: targetAppId }),
    });
  }
  queryClient.invalidateQueries({ queryKey: queryKeys.tokenCount.all });
}

// =============================================================================
// Production adapter
// =============================================================================

export function createProductionChatStreamCommands(
  getDeps: () => ChatStreamRuntimeDeps,
): ChatStreamCommands {
  const latestChunkByChatId = new Map<number, number>();
  const ackTimerByChatId = new Map<number, ReturnType<typeof setTimeout>>();

  function deps(): ChatStreamRuntimeDeps {
    return getDeps();
  }

  function scheduleThrottledAck(chatId: number): void {
    if (ackTimerByChatId.has(chatId)) return;
    const timer = setTimeout(() => {
      ackTimerByChatId.delete(chatId);
      const seq = latestChunkByChatId.get(chatId);
      if (seq === undefined) return;
      void ipc.chat.responseAck({ chatId, lastSeq: seq }).catch(() => {
        // Ignore ack failures; main has no retry path and acks are advisory
        // under throttling.
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

  function showWarningMessage(
    warningMessage: string,
    warningAppId: number | null,
  ): void {
    const settings = deps().getSettings();
    if (warningMessage.startsWith(PNPM_MINIMUM_RELEASE_AGE_WARNING_PREFIX)) {
      if (!shouldShowPnpmMinimumReleaseAgeWarning(settings)) {
        return;
      }
      if (warningAppId !== null) {
        deps().store.set(setPackageManagerWarningForAppAtom, {
          appId: warningAppId,
          warning: { kind: "release-age", message: warningMessage },
        });
      } else {
        showWarning(warningMessage);
      }
      return;
    }
    showWarning(warningMessage);
  }

  function cleanupStreamTransport(chatId: number, streamId: number): void {
    latestChunkByChatId.delete(chatId);
    cancelAckTimer(chatId);
    clearPreviewForChat(
      (update) => deps().store.set(streamingPreviewByChatIdAtom, update),
      chatId,
    );
    ipc.chatStream.release(chatId, streamId);
  }

  return {
    async startStream({ chatId, streamId, request, emit }) {
      const { store, queryClient, getSettings } = deps();
      const settings = getSettings();

      store.set(chatErrorByIdAtom, (prev) => {
        const next = new Map(prev);
        next.set(chatId, null);
        return next;
      });

      const shouldInvalidateFreeModelQuota = isFreeProModel(
        settings?.selectedModel,
      );
      if (shouldInvalidateFreeModelQuota) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.freeModelQuota.status,
        });
      }

      // Convert one file at a time so FileReader does not hold every source
      // buffer concurrently alongside all encoded strings.
      const convertedAttachments =
        request.attachments && request.attachments.length > 0
          ? await convertFileAttachmentsToChatAttachments(request.attachments)
          : undefined;

      // Resolve the target app from the chat itself when the caller didn't pass
      // one. Falling back to `selectedAppId` is wrong for background queue
      // processing, where the user may have switched to a different app while a
      // queued message streams for the original chat.
      const resolvedAppIdFromChat =
        request.appId === undefined
          ? await resolveAppIdForChat(chatId, queryClient)
          : null;
      const targetAppId =
        request.appId ??
        resolvedAppIdFromChat ??
        store.get(selectedAppIdAtom) ??
        null;

      emit({ type: "stream-context", streamId, targetAppId });

      const cachedChat =
        request.requestedChatMode === null
          ? undefined
          : queryClient.getQueryData<Chat>(queryKeys.chats.detail({ chatId }));

      const setMessagesById = makeSetMessagesById(store);
      let hasIncrementedStreamCount = false;

      ipc.chatStream.start(
        {
          chatId,
          prompt: request.prompt,
          redo: request.redo,
          attachments: convertedAttachments,
          selectedComponents: request.selectedComponents ?? [],
          requestedChatMode:
            request.requestedChatMode === null
              ? undefined
              : (request.requestedChatMode ??
                cachedChat?.chatMode ??
                undefined),
        },
        {
          onChunk: (chunk) => {
            const {
              messages: updatedMessages,
              streamingMessageId,
              streamingPatch,
              streamingPreview,
              chunkSeq,
              effectiveChatMode,
              chatModeFallbackReason,
            } = chunk;

            emit({ type: "chunk-received", streamId });

            if (
              handleEffectiveChatModeChunk(
                { effectiveChatMode, chatModeFallbackReason },
                deps().getSettings(),
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
              store.set(chatStreamCountByIdAtom, (prev) => {
                const next = new Map(prev);
                next.set(chatId, (prev.get(chatId) ?? 0) + 1);
                return next;
              });
              hasIncrementedStreamCount = true;
            }

            applyPreviewChunk(
              (update) => store.set(streamingPreviewByChatIdAtom, update),
              chatId,
              streamingPreview,
            );

            if (updatedMessages) {
              // Full messages update (initial load, post-compaction, etc.)
              store.set(chatMessagesByIdAtom, (prev) => {
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

            // Ack-based backpressure for the canned test stream. Real LLM
            // streams omit chunkSeq, so this is a no-op for them. Coalesce many
            // incoming chunks into a single ack fired on a fixed throttle
            // interval (ACK_THROTTLE_MS).
            if (chunkSeq !== undefined) {
              const prev = latestChunkByChatId.get(chatId) ?? 0;
              if (chunkSeq > prev) {
                latestChunkByChatId.set(chatId, chunkSeq);
              }
              scheduleThrottledAck(chatId);
            }
          },
          onEnd: (response) => {
            emit({ type: "stream-ended", streamId, response });
          },
          onError: ({ error, warningMessages }) => {
            emit({ type: "stream-errored", streamId, error, warningMessages });
          },
        },
        // The controller owns the stream lifetime: keep routing events until
        // finalization completes and releases the entry (stale-streamId checks
        // in the machine drop anything that arrives after the terminal event).
        { streamId, autoRelease: false },
      );
    },

    enqueueMessage({ chatId, request }) {
      const { store } = deps();
      // Preserve the FULL original request so the queued dispatch replays it
      // verbatim (redo/appId/requestedChatMode included). `onSettled` is
      // deliberately NOT carried: queue items can be edited or deleted before
      // they run, which would strand the callback forever.
      const newItem: QueuedMessageItem = {
        id: crypto.randomUUID(),
        prompt: request.prompt,
        attachments: request.attachments,
        selectedComponents: request.selectedComponents,
        redo: request.redo,
        appId: request.appId,
        requestedChatMode: request.requestedChatMode,
      };
      store.set(queuedMessagesByIdAtom, (prev) => {
        const next = new Map(prev);
        const existing = prev.get(chatId) ?? [];
        next.set(chatId, [...existing, newItem]);
        return next;
      });
      // `success` means "the stream ran to completion", which has NOT happened
      // for a queued submission — callers key completion-only side effects off
      // it (PlanPanel clears annotations, DyadStepLimit clears the pause
      // latch). Report success: false (like the legacy drop path did) so those
      // side effects don't fire early; `queued: true` distinguishes "accepted
      // into the queue" from a rejected submission.
      request.onSettled?.({ success: false, queued: true });
    },

    requestAbort({ chatId }) {
      void ipc.chat.cancelStream(chatId).catch((err) => {
        console.error(`[CHAT] Failed to request abort for ${chatId}:`, err);
      });
    },

    releaseTransport({ chatId, streamId }) {
      cleanupStreamTransport(chatId, streamId);
    },

    async runEndSideEffects({
      chatId,
      streamId,
      request,
      targetAppId,
      response,
    }) {
      const { store, queryClient, getSettings, getPosthog } = deps();
      const settings = getSettings();

      cleanupStreamTransport(chatId, streamId);

      try {
        // Only treat as successful if NOT cancelled - wasCancelled flag is set
        // by the backend when the user cancels the stream.
        if (response.wasCancelled) {
          store.set(chatMessagesByIdAtom, (prev) => {
            const existingMessages = prev.get(chatId);
            if (!existingMessages) return prev;
            const updatedMessages =
              applyCancellationNoticeToLastAssistantMessage(existingMessages);
            if (updatedMessages === existingMessages) return prev;
            const next = new Map(prev);
            next.set(chatId, updatedMessages);
            return next;
          });
        }

        if (response.pausePromptQueue) {
          store.set(queuePausedByIdAtom, (prev) => {
            const next = new Map(prev);
            next.set(chatId, true);
            return next;
          });
        }

        if (!response.wasCancelled) {
          store.set(publishChatCompletionEventAtom, {
            chatId,
            title: response.chatSummary,
          });
        }

        if (response.updatedFiles) {
          if (settings?.autoExpandPreviewPanel) {
            store.set(isPreviewOpenAtom, true);
          }
          if (targetAppId !== null) {
            store.set(bumpPreviewReloadTokenForAppAtom, targetAppId);
            store.set(pendingScreenshotAppIdsAtom, (pending) => {
              if (pending.has(targetAppId)) return pending;
              return new Set(pending).add(targetAppId);
            });
          }
        }

        if (response.extraFiles) {
          const posthog = getPosthog();
          if (posthog) {
            showExtraFilesToast({
              files: response.extraFiles,
              error: response.extraFilesError,
              posthog,
            });
          }
        }

        for (const warningMessage of response.warningMessages ?? []) {
          showWarningMessage(warningMessage, targetAppId);
        }

        queryClient.invalidateQueries({ queryKey: queryKeys.userBudget.info });
        queryClient.invalidateQueries({
          queryKey: queryKeys.freeAgentQuota.status,
        });
        if (isFreeProModel(settings?.selectedModel)) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.freeModelQuota.status,
          });
        }
        queryClient.invalidateQueries({
          queryKey: queryKeys.proposals.detail({ chatId }),
        });

        if (!response.wasCancelled) {
          // Re-fetch messages to pick up server-assigned fields (e.g.
          // commitHash) that may only be finalized at stream completion.
          try {
            const latestChat = await ipc.chat.getChat(chatId);
            queryClient.setQueryData(
              queryKeys.chats.detail({ chatId }),
              latestChat,
            );
            // Racing-stream guard (from #3324): the machine serializes its OWN
            // streams (submits during finalizing are queued), but non-machine
            // streams (plan implementation, merge-conflict resolution) write
            // the projection directly and may have started while getChat was
            // in flight. Skip just the merge (the remaining invalidations and
            // settlement still run) rather than clobber their in-progress
            // placeholder messages.
            if (!(store.get(isStreamingByIdAtom).get(chatId) ?? false)) {
              store.set(chatMessagesByIdAtom, (prev) => {
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

        invalidatePostStreamQueries(queryClient, targetAppId);
        // Refresh the uncommitted changes banner immediately rather than
        // waiting for its 5s poll, so it reflects the changes made by this
        // stream as soon as it ends.
        queryClient.invalidateQueries({
          queryKey: queryKeys.uncommittedFiles.byApp({ appId: targetAppId }),
        });
        request.onSettled?.({
          success: true,
          pausedByStepLimit: response.pausePromptQueue === true,
        });
      } catch (error) {
        console.error(`[CHAT] Failed to finalize stream for ${chatId}:`, error);
        request.onSettled?.({ success: false });
        throw error;
      }
    },

    runErrorSideEffects({
      chatId,
      streamId,
      request,
      targetAppId,
      error,
      warningMessages,
    }) {
      const { store, queryClient, getSettings } = deps();

      cleanupStreamTransport(chatId, streamId);

      for (const warningMessage of warningMessages ?? []) {
        showWarningMessage(warningMessage, targetAppId);
      }
      console.error(`[CHAT] Stream error for ${chatId}:`, error);
      store.set(chatErrorByIdAtom, (prev) => {
        const next = new Map(prev);
        next.set(chatId, error);
        return next;
      });

      // Invalidate free agent quota to update the UI after error (the server
      // may have refunded the quota).
      queryClient.invalidateQueries({
        queryKey: queryKeys.freeAgentQuota.status,
      });
      if (isFreeProModel(getSettings()?.selectedModel)) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.freeModelQuota.status,
        });
      }

      syncChatFromDb(
        chatId,
        makeSetMessagesById(store),
        "[CHAT] onError",
        store,
      );
      invalidatePostStreamQueries(queryClient, targetAppId);
      request.onSettled?.({ success: false });
    },

    dispatchNextQueued({ chatId, emit }) {
      const { store, queryClient, getPosthog } = deps();
      if (store.get(queuePausedByIdAtom).get(chatId) ?? false) return;
      // Never dequeue while a stream is active for this chat (per-chat guard,
      // matching the legacy useQueueProcessor behavior from #2931). The
      // machine's own streams can't be active at any dispatch site (dispatch
      // fires from terminal states, where the projection is already false), so
      // this specifically guards against NON-machine streams (plan
      // implementation, merge-conflict resolution) that write the projection
      // directly. Their terminal handlers poke the machine, so a skipped
      // dispatch is retried when they finish.
      if (store.get(isStreamingByIdAtom).get(chatId) ?? false) return;

      // Pop the first message atomically.
      let messageToSend: QueuedMessageItem | undefined;
      store.set(queuedMessagesByIdAtom, (prev) => {
        const current = prev.get(chatId) ?? [];
        if (current.length === 0) return prev;
        const [first, ...remainingMessages] = current;
        messageToSend = first;
        const next = new Map(prev);
        if (remainingMessages.length > 0) {
          next.set(chatId, remainingMessages);
        } else {
          next.delete(chatId);
        }
        return next;
      });
      if (!messageToSend) return;

      const chatMode = queryClient.getQueryData<Chat>(
        queryKeys.chats.detail({ chatId }),
      )?.chatMode;

      getPosthog()?.capture("chat:submit", { chatMode });

      emit({
        type: "submit",
        request: {
          prompt: messageToSend.prompt,
          chatId,
          redo: messageToSend.redo ?? false,
          appId: messageToSend.appId,
          attachments: messageToSend.attachments,
          selectedComponents: messageToSend.selectedComponents,
          // Preserve the original request's mode when it carried one
          // (including the explicit `null` = "let main resolve it"); fall back
          // to the cached per-chat mode for items queued without a mode (the
          // manual ChatInput queue path), matching legacy dispatch.
          requestedChatMode:
            messageToSend.requestedChatMode !== undefined
              ? messageToSend.requestedChatMode
              : chatMode,
        },
      });
    },

    syncProjection({ chatId, state }) {
      const { store } = deps();
      const streaming = isStreamActive(state);
      const current = store.get(isStreamingByIdAtom).get(chatId) ?? false;
      if (current === streaming) return;
      store.set(isStreamingByIdAtom, (prev) => {
        const next = new Map(prev);
        next.set(chatId, streaming);
        return next;
      });
    },
  };
}
