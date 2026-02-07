import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { pendingPlanImplementationAtom } from "@/atoms/planAtoms";
import {
  isStreamingByIdAtom,
  chatMessagesByIdAtom,
  chatErrorByIdAtom,
} from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";

/**
 * Hook to handle starting plan implementation when a plan is accepted.
 * Watches for pending plan implementations and sends the plan to the agent
 * AFTER the current stream completes.
 */
export function usePlanImplementation() {
  const pendingPlan = useAtomValue(pendingPlanImplementationAtom);
  const setPendingPlan = useSetAtom(pendingPlanImplementationAtom);
  const isStreamingById = useAtomValue(isStreamingByIdAtom);
  const setIsStreamingById = useSetAtom(isStreamingByIdAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const setErrorById = useSetAtom(chatErrorByIdAtom);

  // Track if we've already triggered implementation for this pending plan
  const hasTriggeredRef = useRef(false);
  // Track the previous streaming state for the pending chat
  const wasStreamingRef = useRef(false);
  // Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Reset trigger flag when pending plan changes
    if (!pendingPlan) {
      hasTriggeredRef.current = false;
      wasStreamingRef.current = false;
      return;
    }

    // Check current streaming state for the pending chat
    const isNowStreaming = isStreamingById.get(pendingPlan.chatId) ?? false;
    const wasStreaming = wasStreamingRef.current;

    // Update the ref for next render
    wasStreamingRef.current = isNowStreaming;

    // Only trigger when:
    // 1. We haven't triggered yet
    // 2. Streaming just completed (was true, now false) OR was never streaming
    const streamJustCompleted = wasStreaming && !isNowStreaming;
    const neverWasStreaming = !wasStreaming && !isNowStreaming;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (
      !hasTriggeredRef.current &&
      (streamJustCompleted || neverWasStreaming)
    ) {
      // Set immediately to prevent duplicate scheduling on rapid re-renders
      hasTriggeredRef.current = true;

      // Capture pending plan value before the timeout to avoid stale closure
      const planToImplement = pendingPlan;

      // Add a small delay to ensure React state has settled after mode switch
      timeoutId = setTimeout(() => {
        const chatId = planToImplement.chatId;

        // Send /implement-plan= command — expanded server-side in chat_stream_handlers
        const prompt = `/implement-plan=${planToImplement.planSlug}`;

        // Set streaming state to true
        setIsStreamingById((prev) => {
          const next = new Map(prev);
          next.set(chatId, true);
          return next;
        });

        // Clear any previous errors
        setErrorById((prev) => {
          const next = new Map(prev);
          next.set(chatId, null);
          return next;
        });

        // Send the message to start implementation using IPC directly
        // (We can't use useStreamChat here because it has conditional hooks)
        ipc.chatStream.start(
          {
            chatId,
            prompt,
            selectedComponents: [],
          },
          {
            onChunk: ({ messages: updatedMessages }) => {
              if (!isMountedRef.current) return;
              // Update the messages so the UI shows the streaming response
              setMessagesById((prev) => {
                const next = new Map(prev);
                next.set(chatId, updatedMessages);
                return next;
              });
            },
            onEnd: () => {
              if (!isMountedRef.current) return;
              // Stream completed - update streaming state
              setIsStreamingById((prev) => {
                const next = new Map(prev);
                next.set(chatId, false);
                return next;
              });
            },
            onError: ({ error }) => {
              if (!isMountedRef.current) return;
              console.error("Plan implementation stream error:", error);
              // Update error state
              setErrorById((prev) => {
                const next = new Map(prev);
                next.set(chatId, error);
                return next;
              });
              // Also set streaming to false on error
              setIsStreamingById((prev) => {
                const next = new Map(prev);
                next.set(chatId, false);
                return next;
              });
            },
          },
        );

        // Clear the pending plan after triggering
        setPendingPlan(null);
      }, 100); // Small delay to let state settle
    }

    return () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, [
    pendingPlan,
    isStreamingById,
    setPendingPlan,
    setIsStreamingById,
    setMessagesById,
    setErrorById,
  ]);
}
