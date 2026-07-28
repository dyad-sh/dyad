import { useCallback } from "react";
import type { ComponentSelection, FileAttachment } from "@/ipc/types";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  queuedMessagesByIdAtom,
  queuePausedByIdAtom,
  type QueuedMessageItem,
} from "@/atoms/chatAtoms";
import type { Chat } from "@/ipc/types";
import { useChatStreamManager } from "@/chat_stream/ChatStreamProvider";
import type { StreamSettledResult } from "@/chat_stream/state";
import {
  isStreamActive,
  selectCanCancel,
  selectIsCancellationSettling,
  selectStreamError,
} from "@/chat_stream/transition";
import { useChatStreamState } from "@/hooks/useChatStream";
import { showError } from "@/lib/toast";
import { useSearch } from "@tanstack/react-router";
import { validateChatAttachmentFiles } from "@/shared/chatAttachmentLimits";

export function getRandomNumberId() {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

async function rejectQueuedOwner(
  item: QueuedMessageItem,
  reason: string,
): Promise<void> {
  if (!item.owner) return;
  if (!item.onAcceptanceRejected) {
    throw new Error("Machine-owned queue item has no rejection callback");
  }
  await item.onAcceptanceRejected(reason);
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
  const streamState = useChatStreamState(chatId) ?? { type: "idle" };

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
    if (chatId === undefined || !selectCanCancel(streamState)) return;
    chatStreamManager.ensure(chatId).send({ type: "cancel" });
  }, [chatId, chatStreamManager, streamState]);

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
      let claimed:
        | { item: QueuedMessageItem; originalIndex: number }
        | undefined;
      setQueuedMessagesById((prev) => {
        const existing = prev.get(chatId) ?? [];
        const originalIndex = existing.findIndex(
          (message) => message.id === id,
        );
        if (originalIndex < 0) return prev;
        claimed = { item: existing[originalIndex], originalIndex };
        const remaining = existing.filter((message) => message.id !== id);
        const next = new Map(prev);
        if (remaining.length > 0) {
          next.set(chatId, remaining);
        } else {
          next.delete(chatId);
        }
        return next;
      });

      const claimedEntry = claimed;
      if (!claimedEntry) return;
      try {
        await rejectQueuedOwner(claimedEntry.item, "removed from queue");
      } catch (error) {
        showError(error);
        setQueuedMessagesById((prev) => {
          const existing = prev.get(chatId) ?? [];
          if (existing.some((message) => message.id === claimedEntry.item.id)) {
            return prev;
          }
          const restored = [...existing];
          restored.splice(
            Math.min(claimedEntry.originalIndex, restored.length),
            0,
            claimedEntry.item,
          );
          const next = new Map(prev);
          next.set(chatId, restored);
          return next;
        });
      }
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

  const clearAllQueuedMessages = useCallback(async () => {
    if (chatId === undefined) return;
    let claimed: Array<{ item: QueuedMessageItem; originalIndex: number }> = [];
    setQueuedMessagesById((prev) => {
      const existing = prev.get(chatId);
      if (!existing?.length) return prev;
      claimed = existing.map((item, originalIndex) => ({
        item,
        originalIndex,
      }));
      const next = new Map(prev);
      next.delete(chatId);
      return next;
    });
    if (claimed.length === 0) return;

    const settlements = await Promise.allSettled(
      claimed.map(({ item }) => rejectQueuedOwner(item, "queue cleared")),
    );
    const failed: Array<{ item: QueuedMessageItem; originalIndex: number }> =
      [];
    let firstError: unknown;
    for (const [index, settlement] of settlements.entries()) {
      if (settlement.status === "rejected") {
        failed.push(claimed[index]);
        firstError ??= settlement.reason;
      }
    }
    if (firstError !== undefined) showError(firstError);
    if (failed.length === 0) return;

    setQueuedMessagesById((prev) => {
      const restored = [...(prev.get(chatId) ?? [])];
      for (const entry of failed) {
        if (restored.some((message) => message.id === entry.item.id)) continue;
        restored.splice(
          Math.min(entry.originalIndex, restored.length),
          0,
          entry.item,
        );
      }
      const next = new Map(prev);
      next.set(chatId, restored);
      return next;
    });
  }, [chatId, setQueuedMessagesById]);

  return {
    streamMessage,
    cancelStream,
    isStreaming:
      hasChatId && chatId !== undefined ? isStreamActive(streamState) : false,
    isCancellationSettling:
      hasChatId && chatId !== undefined
        ? selectIsCancellationSettling(streamState)
        : false,
    error:
      hasChatId && chatId !== undefined ? selectStreamError(streamState) : null,
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
