import { useSetAtom, useStore } from "jotai";
import {
  pendingContinuationProviderAtom,
  pendingIntegrationAtom,
} from "@/atoms/integrationAtoms";
import { useStreamFinished } from "@/chat_stream/ChatStreamProvider";
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
  const store = useStore();
  const setPendingContinuationMap = useSetAtom(pendingContinuationProviderAtom);
  const setPendingIntegrationMap = useSetAtom(pendingIntegrationAtom);
  useStreamFinished(({ chatId }) => {
    // Read at event time: the Continue click writes this atom immediately
    // before its IPC call can unblock and finish the current stream.
    const continuationProvider = store
      .get(pendingContinuationProviderAtom)
      .get(chatId);
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
    } else if (store.get(pendingIntegrationAtom).has(chatId)) {
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
  });
}
