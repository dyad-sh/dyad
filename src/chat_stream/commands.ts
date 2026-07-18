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
import { pendingScreenshotAppIdAtom } from "@/atoms/previewAtoms";
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
import type { ChatMode, UserSettings } from "@/lib/schemas";
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
  /** Run all end-of-stream side effects (throws => finalize-complete { ok: false }). */
  runEndSideEffects(args: {
    chatId: number;
    streamId: number;
    request: StreamRequest;
    response: ChatResponseEnd;
  }): Promise<void>;
  /** Run all stream-error side effects. */
  runErrorSideEffects(args: {
    chatId: number;
    streamId: number;
    request: StreamRequest;
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

// =============================================================================
// Runtime deps (registered once from the root layout)
// =============================================================================

export interface ChatStreamRuntimeDeps {
  store: JotaiStore;
  queryClient: QueryClient;
  getSettings: () => UserSettings | null | undefined;
  getPosthog: () => PostHog | null;
}

let runtimeDeps: ChatStreamRuntimeDeps | null = null;

/** Called from `useChatStreamRuntime()` at the app root (and the test harness). */
export function registerChatStreamRuntimeDeps(
  deps: ChatStreamRuntimeDeps,
): void {
  runtimeDeps = deps;
}

function deps(): ChatStreamRuntimeDeps {
  if (!runtimeDeps) {
    throw new Error(
      "Chat stream runtime deps not registered. Mount useChatStreamRuntime() at the app root before streaming.",
    );
  }
  return runtimeDeps;
}

// =============================================================================
// Ack-based backpressure for the canned test stream
// =============================================================================

// Throttled ack scheduler for the canned test stream's ack-based backpressure.
// Stores the highest chunkSeq received per chatId; at most one ack per
// ACK_THROTTLE_MS is sent per chatId, carrying the latest received seq. Real
// LLM streams omit chunkSeq, so the scheduler is never armed for them.
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

// =============================================================================
// Per-stream context shared between startStream and the terminal side effects
// =============================================================================

interface StreamTurnContext {
  targetAppId: number | null;
  // The mode this turn actually ran in, as resolved by the main process (sent
  // as a dedicated chunk at the start of every stream). Chat mode is stored
  // per-chat, so `settings.selectedChatMode` alone can't tell us how the turn
  // ran.
  effectiveChatModeForTurn?: ChatMode;
}

const turnContexts = new Map<string, StreamTurnContext>();

function turnKey(chatId: number, streamId: number): string {
  return `${chatId}:${streamId}`;
}

// =============================================================================
// Shared helpers
// =============================================================================

type MessagesUpdater = (prev: Map<number, Message[]>) => Map<number, Message[]>;

function makeSetMessagesById(store: JotaiStore) {
  return (update: MessagesUpdater) => store.set(chatMessagesByIdAtom, update);
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

export const productionChatStreamCommands: ChatStreamCommands = {
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

    turnContexts.set(turnKey(chatId, streamId), { targetAppId });

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
            : (request.requestedChatMode ?? cachedChat?.chatMode ?? undefined),
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
            const context = turnContexts.get(turnKey(chatId, streamId));
            if (context) {
              context.effectiveChatModeForTurn = effectiveChatMode;
            }
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
      // The controller owns the stream lifetime: keep routing events (e.g. the
      // real end after a synthetic cancel end) until it releases the stream.
      { streamId, autoRelease: false },
    );
  },

  enqueueMessage({ chatId, request }) {
    const { store } = deps();
    const newItem: QueuedMessageItem = {
      id: crypto.randomUUID(),
      prompt: request.prompt,
      attachments: request.attachments,
      selectedComponents: request.selectedComponents,
    };
    store.set(queuedMessagesByIdAtom, (prev) => {
      const next = new Map(prev);
      const existing = prev.get(chatId) ?? [];
      next.set(chatId, [...existing, newItem]);
      return next;
    });
    request.onSettled?.({ success: true, queued: true });
  },

  requestAbort({ chatId }) {
    void ipc.chat.cancelStream(chatId).catch((err) => {
      console.error(`[CHAT] Failed to request abort for ${chatId}:`, err);
    });
  },

  async runEndSideEffects({ chatId, streamId, request, response }) {
    const { store, queryClient, getSettings, getPosthog } = deps();
    const settings = getSettings();
    const context = turnContexts.get(turnKey(chatId, streamId));
    turnContexts.delete(turnKey(chatId, streamId));
    const targetAppId =
      context?.targetAppId ?? store.get(selectedAppIdAtom) ?? null;

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
          store.set(pendingScreenshotAppIdAtom, targetAppId);
        }
        // Skip the automatic problems refresh for local-agent turns: the
        // agent runs its own type checks (run_type_checks), so a
        // renderer-side re-scan would duplicate the same full TypeScript
        // build moments later. The Problems panel is refreshed manually in
        // agent mode. The effective-mode chunk always arrives before the end
        // event, so the fallbacks are defensive only; prefer the per-chat
        // stored mode over the global selection (chat mode is per-chat).
        const ranAsLocalAgent =
          (context?.effectiveChatModeForTurn ??
            queryClient.getQueryData<Chat>(queryKeys.chats.detail({ chatId }))
              ?.chatMode ??
            settings?.selectedChatMode) === "local-agent";
        if (
          settings?.enableAutoFixProblems &&
          targetAppId !== null &&
          !ranAsLocalAgent
        ) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.problems.byApp({ appId: targetAppId }),
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

      queryClient.invalidateQueries({ queryKey: ["proposal", chatId] });
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
          // No is-streaming re-check needed here: the machine is in
          // `finalizing` for this chat, so a racing new stream cannot start
          // until this command completes (submits are queued instead).
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

  runErrorSideEffects({ chatId, streamId, request, error, warningMessages }) {
    const { store, queryClient, getSettings } = deps();
    const context = turnContexts.get(turnKey(chatId, streamId));
    turnContexts.delete(turnKey(chatId, streamId));
    const targetAppId =
      context?.targetAppId ?? store.get(selectedAppIdAtom) ?? null;

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

    syncChatFromDb(chatId, makeSetMessagesById(store), "[CHAT] onError", store);
    invalidatePostStreamQueries(queryClient, targetAppId);
    request.onSettled?.({ success: false });
  },

  dispatchNextQueued({ chatId, emit }) {
    const { store, queryClient, getPosthog } = deps();
    if (store.get(queuePausedByIdAtom).get(chatId) ?? false) return;

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
        redo: false,
        attachments: messageToSend.attachments,
        selectedComponents: messageToSend.selectedComponents,
        requestedChatMode: chatMode,
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
