import { useRef } from "react";

import {
  useChatStreamManager,
  useStreamFinished,
} from "@/chat_stream/ChatStreamProvider";
import { ipc } from "@/ipc/types";
import { isDyadProEnabled } from "@/lib/schemas";
import { showError } from "@/lib/toast";

import {
  clearPendingReviewContinuation,
  hasPendingReviewContinuation,
  resumePendingReviewContinuation,
  setPendingReviewContinuation,
} from "./subagentReviewContinuation";
import { useSettings } from "./useSettings";

export type ReviewRemediationOutcome = "completed" | "failed" | "paused";

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

export function shouldResumePendingReview(params: {
  wasCancelled: boolean | undefined;
  pausePromptQueue: boolean | undefined;
  hasPendingContinuation: boolean;
}): boolean {
  return (
    !params.wasCancelled &&
    params.pausePromptQueue !== true &&
    params.hasPendingContinuation
  );
}

interface BackgroundAutoReviewParams {
  chatId: number;
  getAutoFix: () => boolean;
  streamFix: (prompt: string) => Promise<ReviewRemediationOutcome>;
  onReviewReleased?: () => Promise<void>;
}

const backgroundAutoReviewChatIds = new Set<number>();
const pendingBackgroundAutoReviews = new Map<
  number,
  BackgroundAutoReviewParams
>();
async function runSingleBackgroundAutoReview(
  params: BackgroundAutoReviewParams,
): Promise<void> {
  await ipc.agent.runAutoReviewBarrier({
    chatId: params.chatId,
    autoFix: false,
  });
  if (pendingBackgroundAutoReviews.has(params.chatId)) return;
  if (!params.getAutoFix()) return;
  const barrier = await ipc.agent.runAutoReviewBarrier({
    chatId: params.chatId,
    autoFix: true,
  });
  if (barrier.outcome !== "fix_required" || !barrier.prompt) {
    return;
  }

  const remediated = await params.streamFix(barrier.prompt);
  if (remediated === "paused") {
    setPendingReviewContinuation(params.chatId, async () => {
      await ipc.agent.runAutoReviewBarrier({
        chatId: params.chatId,
        verification: true,
      });
      await params.onReviewReleased?.();
    });
    return;
  }
  if (remediated === "failed") {
    if (barrier.threadId) {
      await ipc.agent.skipReviewAutoFix({
        chatId: params.chatId,
        threadId: barrier.threadId,
        remediationFailed: true,
      });
    }
    return;
  }
  await ipc.agent.runAutoReviewBarrier({
    chatId: params.chatId,
    verification: true,
  });
}

export async function runBackgroundAutoReview(
  params: BackgroundAutoReviewParams,
): Promise<void> {
  pendingBackgroundAutoReviews.set(params.chatId, params);
  if (backgroundAutoReviewChatIds.has(params.chatId)) return;
  backgroundAutoReviewChatIds.add(params.chatId);
  try {
    while (true) {
      const next = pendingBackgroundAutoReviews.get(params.chatId);
      if (!next) break;
      pendingBackgroundAutoReviews.delete(params.chatId);
      try {
        await runSingleBackgroundAutoReview(next);
      } catch (error) {
        if (!pendingBackgroundAutoReviews.has(params.chatId)) throw error;
      }
    }
  } finally {
    backgroundAutoReviewChatIds.delete(params.chatId);
  }
}

export function useBackgroundAutoReview(): void {
  const manager = useChatStreamManager();
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const remediationChatIdsRef = useRef(new Set<number>());

  const resumeQueue = async (chatId: number): Promise<void> => {
    const snapshot = manager.ensure(chatId).getSnapshot();
    if (!snapshot.queuePaused) return;
    await manager.dispatchQueueEvent(chatId, { type: "RESUME_QUEUE" });
  };

  useStreamFinished((event) => {
    const currentSettings = settingsRef.current;
    const snapshot = manager.ensure(event.chatId).getSnapshot();
    const suppressAutoReview =
      event.suppressAutoReview ||
      remediationChatIdsRef.current.has(event.chatId);
    const hasPendingContinuation = hasPendingReviewContinuation(event.chatId);

    if (event.wasCancelled) {
      clearPendingReviewContinuation(event.chatId);
      if (suppressAutoReview || hasPendingContinuation) {
        void resumeQueue(event.chatId).catch(showError);
      }
      return;
    }

    if (
      shouldResumePendingReview({
        wasCancelled: event.wasCancelled,
        pausePromptQueue:
          snapshot.lastCompletion?.pausePromptQueue === true &&
          !event.reviewBarrierRequested,
        hasPendingContinuation,
      })
    ) {
      void resumePendingReviewContinuation(event.chatId).catch(
        async (error) => {
          await resumeQueue(event.chatId).catch(showError);
          showError(error);
        },
      );
      return;
    }

    if (suppressAutoReview) return;

    // Review barriers are main-owned by the chat-stream actor. The renderer
    // observes their progress but must not start, settle, or release them.
    if (event.reviewBarrierRequested) {
      return;
    }

    if (
      !shouldStartBackgroundAutoReview({
        updatedFiles:
          event.outcome === "completed" &&
          !event.wasCancelled &&
          event.updatedFiles,
        enableAutoReview:
          currentSettings !== undefined &&
          currentSettings !== null &&
          isDyadProEnabled(currentSettings) &&
          currentSettings.enableAutoReview === true,
        hasQueuedMessages:
          snapshot.queuePaused ||
          snapshot.queue.length > 0 ||
          snapshot.phase === "streaming",
        suppressAutoReview,
      })
    ) {
      return;
    }

    void (async () => {
      await runBackgroundAutoReview({
        chatId: event.chatId,
        getAutoFix: () => settingsRef.current?.autoFixReviewIssues === true,
        onReviewReleased: () => resumeQueue(event.chatId),
        streamFix: (prompt) => {
          remediationChatIdsRef.current.add(event.chatId);
          return new Promise<ReviewRemediationOutcome>((resolve) => {
            manager.ensure(event.chatId).send({
              type: "submit",
              request: {
                chatId: event.chatId,
                prompt,
                requestedChatMode: "local-agent",
                onSettled: ({ success, pausedByStepLimit }) => {
                  resolve(
                    pausedByStepLimit
                      ? "paused"
                      : success
                        ? "completed"
                        : "failed",
                  );
                },
              },
            });
          }).finally(() => {
            remediationChatIdsRef.current.delete(event.chatId);
          });
        },
      });

      if (!hasPendingReviewContinuation(event.chatId)) {
        await resumeQueue(event.chatId);
      }
    })().catch(async (error) => {
      await resumeQueue(event.chatId).catch(showError);
      showError(error);
    });
  });
}
