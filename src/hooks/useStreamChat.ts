import { useCallback, useMemo } from "react";
import type { ComponentSelection, FileAttachment } from "@/ipc/types";
import type { QueuedMessageItem } from "@/atoms/chatAtoms";
import type { Chat } from "@/ipc/types";
import { useChatStreamManager } from "@/chat_stream/ChatStreamProvider";
import type { StreamSettledResult } from "@/chat_stream/renderer_facade";
import { useChatStreamState } from "@/hooks/useChatStream";
import { isStreamActive } from "@/chat_stream/transition";
import { showError } from "@/lib/toast";
import { useSearch } from "@tanstack/react-router";
import {
  CHAT_PROMPT_LENGTH_LIMIT_MESSAGE,
  MAX_CHAT_PROMPT_CHARS,
  validateChatAttachmentFiles,
} from "@/shared/chatAttachmentLimits";
import { convertFileAttachmentsToChatAttachments } from "@/lib/chatAttachmentConversion";
import { chatAttachmentToFileAttachment } from "@/lib/attachment_conversion";

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
  const chatStreamManager = useChatStreamManager();

  let chatId: number | undefined;
  if (hasChatId) {
    const { id } = useSearch({ from: "/chat" });
    chatId = id;
  }
  const streamState = useChatStreamState(chatId);
  const queueRevision = streamState?.queueRevision;
  const queuedMessages = useMemo<QueuedMessageItem[]>(
    () =>
      streamState?.queue.map((entry) => ({
        id: entry.itemId,
        prompt: entry.prompt,
        attachments: entry.attachments?.map(chatAttachmentToFileAttachment),
        selectedComponents: entry.selectedComponents,
        redo: entry.redo,
        appId: entry.appId,
        requestedChatMode: entry.requestedChatMode,
        editable: entry.editable,
        removable: entry.removable,
      })) ?? [],
    [streamState?.queue],
  );

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
      onAccepted,
      onAcceptanceRejected,
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
      onAccepted?: () => void;
      onAcceptanceRejected?: (reason: string) => void | Promise<void>;
      onSettled?: (result: StreamSettledResult) => void;
    }) => {
      if (
        (!prompt.trim() && (!attachments || attachments.length === 0)) ||
        !chatId
      ) {
        return;
      }

      if (prompt.length > MAX_CHAT_PROMPT_CHARS) {
        showError(CHAT_PROMPT_LENGTH_LIMIT_MESSAGE);
        onSettled?.({ success: false });
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
      // stream immediately, an idle paused queue appends and resumes FIFO,
      // and chats with an active stream queue the submission (never dropping
      // it during the render lag before `isStreaming` catches up).
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
          onAccepted,
          onAcceptanceRejected,
          onSettled,
        },
      });
    },
    [chatStreamManager],
  );

  const cancelStream = useCallback(() => {
    if (chatId === undefined || !streamState || !isStreamActive(streamState)) {
      return;
    }
    chatStreamManager.ensure(chatId).send({ type: "cancel" });
  }, [chatId, chatStreamManager, streamState]);

  // Memoize queue management functions to prevent unnecessary re-renders
  // in components that depend on these functions (e.g., restore effect)
  const queueMessage = useCallback(
    (message: Omit<QueuedMessageItem, "id">): boolean => {
      if (chatId === undefined) return false;
      if (message.prompt.length > MAX_CHAT_PROMPT_CHARS) {
        showError(CHAT_PROMPT_LENGTH_LIMIT_MESSAGE);
        return false;
      }
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
      if (
        updates.prompt !== undefined &&
        updates.prompt.length > MAX_CHAT_PROMPT_CHARS
      ) {
        showError(CHAT_PROMPT_LENGTH_LIMIT_MESSAGE);
        return;
      }
      const current = queuedMessages.find((message) => message.id === id);
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
    [chatId, chatStreamManager, queueRevision, queuedMessages],
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
      const itemId = queuedMessages[fromIndex]?.id;
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
    [chatId, chatStreamManager, queueRevision, queuedMessages],
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
        ? streamState?.phase === "cancelling" ||
          (streamState?.phase === "finalizing" &&
            streamState.lastCompletion?.outcome === "cancelled")
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
    queuedMessages: hasChatId && chatId !== undefined ? queuedMessages : [],
    queueMessage,
    updateQueuedMessage,
    removeQueuedMessage,
    reorderQueuedMessages,
    clearAllQueuedMessages,
    isPaused:
      hasChatId && chatId !== undefined
        ? (streamState?.queuePaused ?? false)
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
