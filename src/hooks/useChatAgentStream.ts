import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import type { ChatAgentToolResult } from "@/components/chat-agent/types";
import type { ChatAgentRagSource } from "@/ipc/types/chat_agent";
import { nextFlushDelay } from "@/lib/streaming_pace";

/**
 * One entry per in-flight response, keyed by the session that asked for it.
 *
 * Responses outlive the tab being looked at: the user can start an answer,
 * switch to another tab and come back to find it finished. Keeping the buffer
 * and its flush timer per session is what makes that true — a single shared
 * buffer would mean the second tab's stream overwrote the first tab's text.
 */
type StreamState = {
  buffer: string;
  timer: number | null;
  lastFlushedLength: number;
  /** Where this stream's text goes. Bound to its own tab, not the active one. */
  onFlush: ((content: string) => void) | null;
};

export function useChatAgentStream(
  sessionId: string,
  options?: { agentProfile?: "lovable-web-dev" },
) {
  const streamsRef = useRef(new Map<string, StreamState>());
  const [streamingSessions, setStreamingSessions] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [activeTools, setActiveTools] = useState<Record<string, string | null>>(
    {},
  );

  const markStreaming = useCallback((id: string, streaming: boolean) => {
    setStreamingSessions((prev) => {
      if (prev.has(id) === streaming) return prev;
      const next = new Set(prev);
      if (streaming) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** Drops a finished stream: timer stopped, buffer released, flags cleared. */
  const finishStream = useCallback(
    (id: string) => {
      const state = streamsRef.current.get(id);
      if (state?.timer !== null && state?.timer !== undefined) {
        window.clearTimeout(state.timer);
      }
      streamsRef.current.delete(id);
      setActiveTools((prev) => {
        if (prev[id] == null && !(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      markStreaming(id, false);
    },
    [markStreaming],
  );

  /**
   * Reveals this session's buffer in word-group-sized steps: quick ticks while
   * tokens pour in so the display keeps up, slower ones when the stream is
   * sparse so chunks read as phrases rather than stutter. Completed text is
   * never held back — a flush always shows everything received so far.
   */
  const startFlushLoop = useCallback((id: string) => {
    const tick = () => {
      const state = streamsRef.current.get(id);
      if (!state) return;
      if (state.buffer.length !== state.lastFlushedLength) {
        state.onFlush?.(state.buffer);
      }
      const growth = state.buffer.length - state.lastFlushedLength;
      state.lastFlushedLength = state.buffer.length;
      // Pace the reveal by where the text is — a beat after a sentence, a
      // longer one between paragraphs, quick through lists and code.
      state.timer = window.setTimeout(
        tick,
        nextFlushDelay({ growth, revealed: state.buffer }),
      );
    };
    const state = streamsRef.current.get(id);
    if (state) state.timer = window.setTimeout(tick, 30);
  }, []);

  // Leaving the page must not leave flush timers ticking against a component
  // that no longer exists. The streams themselves keep running in the main
  // process; only this side's reveal loop is torn down.
  useEffect(() => {
    const streams = streamsRef.current;
    return () => {
      for (const state of streams.values()) {
        if (state.timer !== null) window.clearTimeout(state.timer);
      }
      streams.clear();
    };
  }, []);

  const runStream = useCallback(
    (
      params: {
        sessionId: string;
        message?: string;
        conversationHistory?: Array<{
          role: "user" | "assistant";
          content: string;
        }>;
        agentProfile?: "lovable-web-dev";
        selectedMcpToolKeys?: string[];
        selectedMcpWorkflowKeys?: string[];
        vectorCollectionIds?: string[];
        regenerate?: boolean;
      },
      callbacks: {
        onAssistantFlush: (content: string) => void;
        onToolResult: (result: ChatAgentToolResult) => void;
        onRagSources?: (sources: ChatAgentRagSource[]) => void;
        onComplete: () => void;
        onError: (error: string) => void;
      },
    ) => {
      // The stream belongs to the session that started it, whatever the user
      // is looking at by the time it finishes.
      const id = params.sessionId;
      streamsRef.current.set(id, {
        buffer: "",
        timer: null,
        lastFlushedLength: 0,
        onFlush: callbacks.onAssistantFlush,
      });
      setActiveTools((prev) => ({
        ...prev,
        [id]: params.vectorCollectionIds?.length
          ? "Accessing local knowledge base"
          : null,
      }));
      markStreaming(id, true);

      ipc.chatAgentStream.start(params, {
        onChunk: (data) => {
          const state = streamsRef.current.get(id);
          if (!state) return;
          if (data.delta) {
            state.buffer += data.delta;
          }
          if (data.toolResult) {
            callbacks.onToolResult(data.toolResult);
          }
          if (data.ragSources) {
            callbacks.onRagSources?.(data.ragSources);
          }
          if (data.toolActivity) {
            setActiveTools((prev) => ({
              ...prev,
              [id]:
                data.toolActivity?.status === "running"
                  ? data.toolActivity.toolName
                  : prev[id] === data.toolActivity?.toolName
                    ? null
                    : (prev[id] ?? null),
            }));
          }
        },
        onEnd: () => {
          const state = streamsRef.current.get(id);
          const finalContent = state?.buffer ?? "";
          finishStream(id);
          callbacks.onAssistantFlush(finalContent);
          callbacks.onComplete();
        },
        onError: (data) => {
          finishStream(id);
          callbacks.onError(data.error);
          showError(data.error);
        },
      });

      startFlushLoop(id);
    },
    [finishStream, markStreaming, startFlushLoop],
  );

  const sendMessage = useCallback(
    (
      message:
        | string
        | {
            message: string;
            displayMessage?: string;
            selectedMcpToolKeys?: string[];
            selectedMcpWorkflowKeys?: string[];
            vectorCollectionIds?: string[];
            agentProfile?: "lovable-web-dev";
            conversationHistory?: Array<{
              role: "user" | "assistant";
              content: string;
            }>;
          },
      callbacks: {
        onUserMessage: (content: string) => void;
        onAssistantFlush: (content: string) => void;
        onToolResult: (result: ChatAgentToolResult) => void;
        onRagSources?: (sources: ChatAgentRagSource[]) => void;
        onComplete: () => void;
        onError: (error: string) => void;
      },
    ) => {
      const rawMessage =
        typeof message === "string" ? message : message.message;
      const trimmed = rawMessage.trim();
      // Only this tab's own stream blocks it; another tab answering does not.
      if (!trimmed || streamingSessions.has(sessionId)) {
        return;
      }

      const displayMessage =
        typeof message === "string"
          ? trimmed
          : message.displayMessage?.trim() || trimmed;
      callbacks.onUserMessage(displayMessage);
      runStream(
        {
          sessionId,
          message: trimmed,
          conversationHistory:
            typeof message === "string"
              ? undefined
              : message.conversationHistory,
          agentProfile:
            typeof message === "string"
              ? options?.agentProfile
              : (message.agentProfile ?? options?.agentProfile),
          selectedMcpToolKeys:
            typeof message === "string"
              ? undefined
              : message.selectedMcpToolKeys,
          selectedMcpWorkflowKeys:
            typeof message === "string"
              ? undefined
              : message.selectedMcpWorkflowKeys,
          vectorCollectionIds:
            typeof message === "string"
              ? undefined
              : message.vectorCollectionIds,
        },
        {
          onAssistantFlush: callbacks.onAssistantFlush,
          onToolResult: callbacks.onToolResult,
          onRagSources: callbacks.onRagSources,
          onComplete: callbacks.onComplete,
          onError: callbacks.onError,
        },
      );
    },
    [options?.agentProfile, runStream, sessionId, streamingSessions],
  );

  const regenerate = useCallback(
    (
      callbacks: {
        onAssistantFlush: (content: string) => void;
        onToolResult: (result: ChatAgentToolResult) => void;
        onRagSources?: (sources: ChatAgentRagSource[]) => void;
        onComplete: () => void;
        onError: (error: string) => void;
      },
      conversationHistory?: Array<{
        role: "user" | "assistant";
        content: string;
      }>,
    ) => {
      if (streamingSessions.has(sessionId)) return;
      runStream(
        {
          sessionId,
          regenerate: true,
          conversationHistory,
          agentProfile: options?.agentProfile,
        },
        callbacks,
      );
    },
    [options?.agentProfile, runStream, sessionId, streamingSessions],
  );

  /** Stops a session's response; defaults to the one being viewed. */
  const cancel = useCallback(
    (target?: string) => {
      const id = target ?? sessionId;
      const state = streamsRef.current.get(id);
      void ipc.chatAgent.cancel(id);
      // Flush what the interval had not yet delivered; stopping must keep
      // every word generated up to that moment.
      if (state?.buffer && state.onFlush) {
        state.onFlush(state.buffer);
      }
      finishStream(id);
    },
    [finishStream, sessionId],
  );

  return {
    sendMessage,
    regenerate,
    cancel,
    isStreaming: streamingSessions.has(sessionId),
    activeTool: activeTools[sessionId] ?? null,
    /** Every session currently answering, so tabs can show it. */
    streamingSessions,
  };
}
