import { useCallback } from "react";
import type { ComponentSelection, FileAttachment } from "@/ipc/types";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  chatErrorByIdAtom,
  isStreamingByIdAtom,
  queuedMessagesByIdAtom,
  queuePausedByIdAtom,
  type QueuedMessageItem,
} from "@/atoms/chatAtoms";
import type { Chat } from "@/ipc/types";
import { useChatStreamManager } from "@/chat_stream/ChatStreamProvider";
import type { StreamSettledResult } from "@/chat_stream/state";
import { showError } from "@/lib/toast";
import { useSearch } from "@tanstack/react-router";
import { validateChatAttachmentFiles } from "@/shared/chatAttachmentLimits";

export function getRandomNumberId() {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

/**
 * Chat streaming facade for React components.
 *
 * The stream lifecycle itself (start/cancel/finalize/queue dispatch) is owned
 * by the per-chat state machine in `src/chat_stream/`; this hook validates
 * submissions, forwards them as machine events, and exposes the legacy
 * projections (`isStreamingByIdAtom`, `chatErrorByIdAtom`) plus the prompt
 * queue helpers.
 */
export function useStreamChat({
  hasChatId = true,
}: { hasChatId?: boolean } = {}) {
  const isStreamingById = useAtomValue(isStreamingByIdAtom);
  const errorById = useAtomValue(chatErrorByIdAtom);
  const setErrorById = useSetAtom(chatErrorByIdAtom);
  const [queuedMessagesById, setQueuedMessagesById] = useAtom(
    queuedMessagesByIdAtom,
  );
  const queuePausedById = useAtomValue(queuePausedByIdAtom);
  const setQueuePausedById = useSetAtom(queuePausedByIdAtom);
  const chatStreamManager = useChatStreamManager();

  let chatId: number | undefined;
  if (hasChatId) {
    const { id } = useSearch({ from: "/chat" });
    chatId = id;
  }

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
          onSettled,
        },
      });
    },
    [chatStreamManager],
  );

  const cancelStream = useCallback(() => {
    if (chatId === undefined) return;
    chatStreamManager.ensure(chatId).send({ type: "cancel" });
  }, [chatId, chatStreamManager]);

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
      // The render that chose this manual queue path may be stale: the
      // machine can already be idle after running its terminal queue
      // dispatch. Poke it after the synchronous atom update so the newly
      // appended item is not left without a driver. Active machines ignore
      // the poke and drain normally when they finalize.
      chatStreamManager.ensure(chatId).send({ type: "queue-poked" });
      return true;
    },
    [chatId, chatStreamManager, setQueuedMessagesById],
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
          msg.id === id && !msg.owner && !msg.userInputRequestId
            ? { ...msg, ...updates }
            : msg,
        );
        next.set(chatId, updated);
        return next;
      });
    },
    [chatId, setQueuedMessagesById],
  );

  const removeQueuedMessage = useCallback(
    async (id: string) => {
      if (chatId === undefined) return;
      const item = queuedMessagesById
        .get(chatId)
        ?.find((message) => message.id === id);
      if (item?.owner) {
        try {
          await chatStreamManager.rejectUserInputHandoff(
            item.owner,
            "removed from queue",
          );
        } catch (error) {
          showError(error);
          return;
        }
      }
      setQueuedMessagesById((prev) => {
        const next = new Map(prev);
        const existing = prev.get(chatId) ?? [];
        const filtered = existing.filter((msg) => msg.id !== id);
        if (filtered.length === existing.length) return prev;
        if (filtered.length > 0) {
          next.set(chatId, filtered);
        } else {
          next.delete(chatId);
        }
        return next;
      });
    },
    [chatId, chatStreamManager, queuedMessagesById, setQueuedMessagesById],
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

  const clearAllQueuedMessages = useCallback(async () => {
    if (chatId === undefined) return;
    const current = queuedMessagesById.get(chatId) ?? [];
    const settlements = await Promise.allSettled(
      current.map((message) =>
        message.owner
          ? chatStreamManager.rejectUserInputHandoff(
              message.owner,
              "queue cleared",
            )
          : Promise.resolve(),
      ),
    );
    const clearedIds = new Set<string>();
    let firstError: unknown;
    for (const [index, settlement] of settlements.entries()) {
      if (settlement.status === "fulfilled") {
        clearedIds.add(current[index].id);
      } else {
        firstError ??= settlement.reason;
      }
    }
    if (firstError !== undefined) showError(firstError);
    setQueuedMessagesById((prev) => {
      const existing = prev.get(chatId);
      if (!existing) return prev;
      const remaining = existing.filter(
        (message) => !clearedIds.has(message.id),
      );
      if (remaining.length === existing.length) return prev;
      const next = new Map(prev);
      if (remaining.length > 0) {
        next.set(chatId, remaining);
      } else {
        next.delete(chatId);
      }
      return next;
    });
  }, [chatId, chatStreamManager, queuedMessagesById, setQueuedMessagesById]);

  return {
    streamMessage,
    cancelStream,
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
      // Poke the machine: if it's idle (or errored) it emits a
      // dispatch-next-queued command; if a stream is active the poke is
      // ignored and the queue drains on the next finalize.
      chatStreamManager.ensure(chatId).send({ type: "queue-poked" });
    }, [chatId, chatStreamManager, setQueuePausedById]),
  };
}
