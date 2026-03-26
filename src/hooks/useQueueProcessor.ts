import { useEffect } from "react";
import { useAtom } from "jotai";
import {
  queuedMessagesByIdAtom,
  streamCompletedSuccessfullyByIdAtom,
  queuePausedByIdAtom,
  type QueuedMessageItem,
} from "@/atoms/chatAtoms";
import { useStreamChat } from "./useStreamChat";
import { usePostHog } from "posthog-js/react";
import { useSettings } from "./useSettings";

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
  const [queuePausedById] = useAtom(queuePausedByIdAtom);
  const posthog = usePostHog();
  const { settings } = useSettings();

  useEffect(() => {
    // Find any chatId that has both completed successfully and has queued messages
    for (const [chatId, queuedMessages] of queuedMessagesById) {
      if (queuedMessages.length === 0) continue;

      const completedSuccessfully =
        streamCompletedSuccessfullyById.get(chatId) ?? false;
      if (!completedSuccessfully) continue;

      const isPaused = queuePausedById.get(chatId) ?? false;
      if (isPaused) continue;

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

      posthog.capture("chat:submit", {
        chatMode: settings?.selectedChatMode,
      });

      streamMessage({
        prompt: messageToSend.prompt,
        chatId,
        redo: false,
        attachments: messageToSend.attachments,
        selectedComponents: messageToSend.selectedComponents,
      });

      // Only process one chatId per effect run
      break;
    }
  }, [
    queuedMessagesById,
    streamCompletedSuccessfullyById,
    queuePausedById,
    streamMessage,
    setQueuedMessagesById,
    setStreamCompletedSuccessfullyById,
    posthog,
    settings?.selectedChatMode,
  ]);
}
