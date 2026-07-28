import { useCallback } from "react";
import type { ComponentSelection, FileAttachment } from "@/ipc/types";
import { useAtomValue } from "jotai";
import {
  queuedMessagesByIdAtom,
  queuePausedByIdAtom,
  type QueuedMessageItem,
} from "@/atoms/chatAtoms";
import type { Chat } from "@/ipc/types";
import { useChatStreamManager } from "@/chat_stream/ChatStreamProvider";
import type { StreamSettledResult } from "@/chat_stream/state";
import { useChatStreamState } from "@/hooks/useChatStream";
import {
  isStreamActive,
  selectIsCancellationSettling,
} from "@/chat_stream/transition";
import { showError } from "@/lib/toast";
import { useSearch } from "@tanstack/react-router";
import { validateChatAttachmentFiles } from "@/shared/chatAttachmentLimits";
import { convertFileAttachmentsToChatAttachments } from "@/lib/chatAttachmentConversion";

export function getRandomNumberId() {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

/**
 * Chat streaming facade for React components.
 *
 * The stream lifecycle itself (start/cancel/finalize/queue dispatch) is owned
 * by the per-chat state machine in `src/chat_stream/`; this hook validates
 * submissions, forwards them as machine events, and exposes authoritative
 * machine status/error plus the prompt queue helpers.
 */
export function useStreamChat({
  hasChatId = true,
}: { hasChatId?: boolean } = {}) {
  const queuedMessagesById = useAtomValue(queuedMessagesByIdAtom);
  const queuePausedById = useAtomValue(queuePausedByIdAtom);
  const chatStreamManager = useChatStreamManager();

  let chatId: number | undefined;
  if (hasChatId) {
    const { id } = useSearch({ from: "/chat" });
    chatId = id;
  }
  const streamState = useChatStreamState(chatId);
  const queueRevision =
    streamState && "queueRevision" in streamState
      ? streamState.queueRevision
      : undefined;

  const streamMessage = useCallback(
    async ({
      prompt,
      chatId,
      appId,
      redo,
      attachments,
      selectedComponents,
      requestedChatMode,
      planAcceptInNewChat,
      onSettled,
    }: {
      prompt: string;
      chatId: number;
      appId?: number;
      redo?: boolean;
      attachments?: FileAttachment[];
      selectedComponents?: ComponentSelection[];
      requestedChatMode?: Chat["chatMode"] | null;
      planAcceptInNewChat?: boolean;
      onSettled?: (result: StreamSettledResult) => void;
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

      // The machine decides what happens next: idle/errored chats start a
      // stream immediately; chats with an active stream get the submission
      // queued (never dropped, even in the render lag window where the
      // `isStreaming` projection hasn't caught up yet).
      chatStreamManager.ensure(chatId).send({
        type: "submit",
        request: {
          prompt,
          chatId,
          appId,
          redo,
          attachments,
          selectedComponents,
          requestedChatMode,
          planAcceptInNewChat,
          onSettled,
        },
      });
    },
    [chatStreamManager],
  );

  const cancelStream = useCallback(() => {
    if (
      chatId === undefined ||
      !streamState ||
      ("capabilities" in streamState
        ? !streamState.capabilities.canCancel
        : !isStreamActive(streamState))
    ) {
      return;
    }
    chatStreamManager.ensure(chatId).send({ type: "cancel" });
  }, [chatId, chatStreamManager, streamState]);

  // Memoize queue management functions to prevent unnecessary re-renders
  // in components that depend on these functions (e.g., restore effect)
  const queueMessage = useCallback(
    (message: Omit<QueuedMessageItem, "id">): boolean => {
      if (chatId === undefined) return false;
      chatStreamManager.ensure(chatId).send({
        type: "submit",
        request: { ...message, chatId },
      });
      return true;
    },
    [chatId, chatStreamManager],
  );

  const updateQueuedMessage = useCallback(
    (
      id: string,
      updates: Partial<
        Pick<QueuedMessageItem, "prompt" | "attachments" | "selectedComponents">
      >,
    ) => {
      if (chatId === undefined) return;
      const current = queuedMessagesById
        .get(chatId)
        ?.find((message) => message.id === id);
      if (!current) return;
      void convertFileAttachmentsToChatAttachments(
        updates.attachments ?? current.attachments ?? [],
      )
        .then((serializedAttachments) =>
          chatStreamManager.dispatchQueueEvent(
            chatId,
            {
              type: "EDIT_QUEUE_ENTRY",
              itemId: id,
              prompt: updates.prompt ?? current.prompt,
              attachments: serializedAttachments,
              selectedComponents:
                updates.selectedComponents ?? current.selectedComponents,
            },
            queueRevision,
          ),
        )
        .catch(showError);
    },
    [chatId, chatStreamManager, queueRevision, queuedMessagesById],
  );

  const removeQueuedMessage = useCallback(
    async (id: string) => {
      if (chatId === undefined) return;
      try {
        await chatStreamManager.dispatchQueueEvent(
          chatId,
          {
            type: "REMOVE_QUEUE_ENTRY",
            itemId: id,
          },
          queueRevision,
        );
      } catch (error) {
        showError(error);
      }
    },
    [chatId, chatStreamManager, queueRevision],
  );

  const reorderQueuedMessages = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (chatId === undefined) return;
      const itemId = queuedMessagesById.get(chatId)?.[fromIndex]?.id;
      if (!itemId) return;
      void chatStreamManager
        .dispatchQueueEvent(
          chatId,
          {
            type: "REORDER_QUEUE_ENTRY",
            itemId,
            toIndex,
          },
          queueRevision,
        )
        .catch(showError);
    },
    [chatId, chatStreamManager, queueRevision, queuedMessagesById],
  );

  const clearAllQueuedMessages = useCallback(async () => {
    if (chatId === undefined) return;
    try {
      await chatStreamManager.dispatchQueueEvent(
        chatId,
        {
          type: "CLEAR_QUEUE",
        },
        queueRevision,
      );
    } catch (error) {
      showError(error);
    }
  }, [chatId, chatStreamManager, queueRevision]);

  return {
    streamMessage,
    cancelStream,
    isStreaming:
      hasChatId && chatId !== undefined
        ? !!streamState && isStreamActive(streamState)
        : false,
    isCancellationSettling:
      hasChatId && chatId !== undefined
        ? !!streamState &&
          ("phase" in streamState
            ? streamState.phase === "cancelling" ||
              (streamState.phase === "finalizing" &&
                streamState.lastCompletion?.outcome === "cancelled")
            : selectIsCancellationSettling(streamState))
        : false,
    error:
      hasChatId && chatId !== undefined && streamState && "error" in streamState
        ? (streamState.error ?? null)
        : null,
    setError: (value: string | null) => {
      if (chatId === undefined || value === null) return;
      chatStreamManager.ensure(chatId).send({
        type: "external-error",
        error: value,
      });
    },
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
      void chatStreamManager
        .dispatchQueueEvent(chatId, { type: "PAUSE_QUEUE" }, queueRevision)
        .catch(showError);
    }, [chatId, chatStreamManager, queueRevision]),
    clearPauseOnly: useCallback(() => {
      if (chatId === undefined) return;
      void chatStreamManager
        .dispatchQueueEvent(chatId, { type: "RESUME_QUEUE" }, queueRevision)
        .catch(showError);
    }, [chatId, chatStreamManager, queueRevision]),
    resumeQueue: useCallback(() => {
      if (chatId === undefined) return;
      void chatStreamManager
        .dispatchQueueEvent(chatId, { type: "RESUME_QUEUE" }, queueRevision)
        .catch(showError);
    }, [chatId, chatStreamManager, queueRevision]),
  };
}
