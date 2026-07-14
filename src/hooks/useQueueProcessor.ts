import { useEffect } from "react";
import { useAtom } from "jotai";
import {
  queuedMessagesByIdAtom,
  streamCompletedSuccessfullyByIdAtom,
  queuePausedByIdAtom,
  isStreamingByIdAtom,
  type QueuedMessageItem,
} from "@/atoms/chatAtoms";
import { useStreamChat } from "./useStreamChat";
import { usePostHog } from "posthog-js/react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import type { Chat } from "@/ipc/types";
import { ipc } from "@/ipc/types";

const reviewBarrierInFlight = new Set<number>();
const reviewBarrierPassed = new Set<number>();

export async function runQueuedReviewFlow(params: {
  runBarrier: (verification?: boolean) => Promise<{
    outcome: "released" | "skipped" | "fix_required";
    threadId?: string;
    prompt?: string;
  }>;
  streamRemediation: (prompt: string) => Promise<boolean>;
  onRemediationFailed?: (threadId: string) => Promise<void>;
}): Promise<"released"> {
  const barrier = await params.runBarrier();
  if (barrier.outcome !== "fix_required" || !barrier.prompt) {
    return "released";
  }

  const remediated = await params.streamRemediation(barrier.prompt);
  // A failed or denied remediation remains visible, but the user's queued
  // message must still be released rather than stranded behind the barrier.
  if (!remediated) {
    if (barrier.threadId) {
      await params.onRemediationFailed?.(barrier.threadId);
    }
    return "released";
  }

  // The queued user message remains paused until the remediation turn has
  // itself been independently reviewed. The main process treats this as a
  // verification review and will never start another remediation countdown.
  await params.runBarrier(true);
  return "released";
}

/**
 * Root-level hook that processes queued messages for any chat,
 * even when the user is not on the chat page.
 */
export function useQueueProcessor() {
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const [queuedMessagesById, setQueuedMessagesById] = useAtom(
    queuedMessagesByIdAtom,
  );
  const [streamCompletedSuccessfullyById, setStreamCompletedSuccessfullyById] =
    useAtom(streamCompletedSuccessfullyByIdAtom);
  const [queuePausedById, setQueuePausedById] = useAtom(queuePausedByIdAtom);
  const [isStreamingById] = useAtom(isStreamingByIdAtom);
  const posthog = usePostHog();
  const queryClient = useQueryClient();

  useEffect(() => {
    for (const chatId of reviewBarrierPassed) {
      if (!queuedMessagesById.has(chatId)) reviewBarrierPassed.delete(chatId);
    }
    // Find any chatId that has both completed successfully and has queued messages
    for (const [chatId, queuedMessages] of queuedMessagesById) {
      if (queuedMessages.length === 0) continue;

      const isPaused = queuePausedById.get(chatId) ?? false;
      if (isPaused) continue;

      const isStreaming = isStreamingById.get(chatId) ?? false;
      // Never dequeue while a stream is active for this chat
      if (isStreaming) continue;

      const completedSuccessfully =
        streamCompletedSuccessfullyById.get(chatId) ?? false;
      // Only dequeue if the previous stream completed successfully
      if (!completedSuccessfully) continue;

      if (!reviewBarrierPassed.has(chatId)) {
        if (reviewBarrierInFlight.has(chatId)) continue;
        reviewBarrierInFlight.add(chatId);
        setQueuePausedById((prev) => {
          const next = new Map(prev);
          next.set(chatId, true);
          return next;
        });
        void runQueuedReviewFlow({
          runBarrier: (verification) =>
            ipc.agent.runAutoReviewBarrier({ chatId, verification }),
          streamRemediation: (prompt) =>
            new Promise<boolean>((resolve) => {
              streamMessage({
                prompt,
                chatId,
                redo: false,
                requestedChatMode: "local-agent",
                suppressAutoReview: true,
                onSettled: ({ success }) => resolve(success),
              });
            }),
          onRemediationFailed: (threadId) =>
            ipc.agent.skipReviewAutoFix({ chatId, threadId }),
        })
          .then(() => {
            // Every terminal review/remediation outcome releases the user's
            // queued message. Failures stay visible in the agent card but
            // must never strand the FIFO queue.
            reviewBarrierPassed.add(chatId);
          })
          .catch(() => {
            // Review infrastructure failures are non-blocking. This mirrors
            // the manager's fail-open barrier while still guaranteeing that
            // a review was attempted before the queued message is released.
            reviewBarrierPassed.add(chatId);
          })
          .finally(() => {
            reviewBarrierInFlight.delete(chatId);
            if (!reviewBarrierPassed.has(chatId)) return;
            setStreamCompletedSuccessfullyById((prev) => {
              const next = new Map(prev);
              next.set(chatId, true);
              return next;
            });
            setQueuePausedById((prev) => {
              const next = new Map(prev);
              next.set(chatId, false);
              return next;
            });
          });
        break;
      }

      // Clear the successful completion flag first to prevent loops
      setStreamCompletedSuccessfullyById((prev) => {
        const next = new Map(prev);
        next.set(chatId, false);
        return next;
      });

      // Get and remove the first message atomically
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
      reviewBarrierPassed.delete(chatId);

      const chatMode = queryClient.getQueryData<Chat>(
        queryKeys.chats.detail({ chatId }),
      )?.chatMode;

      posthog.capture("chat:submit", { chatMode });

      streamMessage({
        prompt: messageToSend.prompt,
        chatId,
        redo: false,
        attachments: messageToSend.attachments,
        selectedComponents: messageToSend.selectedComponents,
        requestedChatMode: chatMode,
      });

      // Only process one chatId per effect run
      break;
    }
  }, [
    queuedMessagesById,
    streamCompletedSuccessfullyById,
    queuePausedById,
    isStreamingById,
    streamMessage,
    setQueuedMessagesById,
    setStreamCompletedSuccessfullyById,
    setQueuePausedById,
    posthog,
    queryClient,
  ]);
}
