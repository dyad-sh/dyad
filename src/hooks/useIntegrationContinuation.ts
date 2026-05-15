import { useEffect, useRef } from "react";
import { useAtom } from "jotai";
import {
  pendingContinuationProviderAtom,
  pendingIntegrationAtom,
} from "@/atoms/integrationAtoms";
import { isStreamingByIdAtom } from "@/atoms/chatAtoms";
import { useStreamChat } from "./useStreamChat";

/**
 * Root-level hook that processes integration continuation messages and cleans
 * up stale integration state once a chat's stream ends.
 *
 * Why root-level: the chat's `dyad-add-integration` card lives inside the
 * virtualized message list, so it can unmount while the user scrolls. If the
 * continuation dispatch lived on that card, scrolling away mid-stream would
 * silently drop the "Continue. I have completed the X integration." message.
 *
 * Two responsibilities, both keyed on the stream-end transition:
 * 1. If `pendingContinuationProviderAtom` has an entry for a chat that just
 *    stopped streaming, send the continuation message.
 * 2. If `pendingIntegrationAtom` still holds a request for a chat that
 *    stopped streaming, the backend's resolver has already been cleared
 *    (timeout/abort/normal completion) — drop the renderer's copy so the
 *    chat card and Configure panel don't keep showing a dead request.
 */
export function useIntegrationContinuation() {
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const [pendingContinuationMap, setPendingContinuationMap] = useAtom(
    pendingContinuationProviderAtom,
  );
  const [pendingIntegrationMap, setPendingIntegrationMap] = useAtom(
    pendingIntegrationAtom,
  );
  const [isStreamingById] = useAtom(isStreamingByIdAtom);

  // Track which chats were streaming on the previous render so we can detect
  // the streaming -> not-streaming transition (rather than just "currently
  // not streaming", which would be true for every unrelated render).
  const prevStreamingRef = useRef<Map<number, boolean>>(new Map());

  useEffect(() => {
    const prevStreaming = prevStreamingRef.current;
    const justStopped: number[] = [];

    for (const [chatId, wasStreaming] of prevStreaming) {
      const isStreaming = isStreamingById.get(chatId) ?? false;
      if (wasStreaming && !isStreaming) {
        justStopped.push(chatId);
      }
    }

    prevStreamingRef.current = new Map(isStreamingById);

    if (justStopped.length === 0) return;

    for (const chatId of justStopped) {
      const continuationProvider = pendingContinuationMap.get(chatId);
      if (continuationProvider) {
        setPendingContinuationMap((prev) => {
          if (!prev.has(chatId)) return prev;
          const next = new Map(prev);
          next.delete(chatId);
          return next;
        });
        streamMessage({
          chatId,
          prompt: `Continue. I have completed the ${continuationProvider} integration.`,
        });
      } else if (pendingIntegrationMap.has(chatId)) {
        // Stream ended without a Continue click — the backend has already
        // resolved/cleared its resolver (timeout, abort, or natural exit), so
        // the renderer's pending entry is stale. Drop it.
        setPendingIntegrationMap((prev) => {
          if (!prev.has(chatId)) return prev;
          const next = new Map(prev);
          next.delete(chatId);
          return next;
        });
      }
    }
  }, [
    isStreamingById,
    pendingContinuationMap,
    pendingIntegrationMap,
    setPendingContinuationMap,
    setPendingIntegrationMap,
    streamMessage,
  ]);
}
