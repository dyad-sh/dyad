import { useCallback, useEffect, useRef, useState } from "react";

interface CancellationRequestLatchOptions {
  chatId?: number;
  isStreaming: boolean;
  isCancellationSettling: boolean;
}

/**
 * Closes the render-lag window between a Stop click and the chat stream
 * machine publishing its authoritative cancelling state.
 */
export function useCancellationRequestLatch({
  chatId,
  isStreaming,
  isCancellationSettling,
}: CancellationRequestLatchOptions) {
  const requestedChatIdRef = useRef<number | null>(null);
  const observedSettlingChatIdRef = useRef<number | null>(null);
  const [requestedChatId, setRequestedChatId] = useState<number | null>(null);

  useEffect(() => {
    if (
      requestedChatIdRef.current !== null &&
      requestedChatIdRef.current !== chatId
    ) {
      requestedChatIdRef.current = null;
      observedSettlingChatIdRef.current = null;
      setRequestedChatId(null);
    }
  }, [chatId]);

  useEffect(() => {
    if (chatId == null || requestedChatIdRef.current !== chatId) return;
    if (isCancellationSettling) {
      observedSettlingChatIdRef.current = chatId;
      return;
    }
    // A very fast cancellation can reach idle before React ever projects the
    // intermediate cancelling phase. Otherwise wait until that phase has been
    // observed and then settles back out.
    if (!isStreaming || observedSettlingChatIdRef.current === chatId) {
      requestedChatIdRef.current = null;
      observedSettlingChatIdRef.current = null;
      setRequestedChatId((current) => (current === chatId ? null : current));
    }
  }, [chatId, isCancellationSettling, isStreaming]);

  const requestCancellation = useCallback(() => {
    if (chatId == null || requestedChatIdRef.current === chatId) {
      return false;
    }
    requestedChatIdRef.current = chatId;
    observedSettlingChatIdRef.current = null;
    setRequestedChatId(chatId);
    return true;
  }, [chatId]);

  return {
    isCancellationRequested:
      isCancellationSettling || requestedChatId === chatId,
    requestCancellation,
  };
}
