import { useEffect, useRef, useState } from "react";

import { ipc } from "@/ipc/types";

export type AgentChatMsg = {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
};

/**
 * Shared chat + streaming state for an Agent OS agent. Both the bubble-style
 * and main-chat-style presentations consume this so the live streaming logic
 * lives in one place.
 */
export function useAgentChat(activeId: string) {
  const [messages, setMessages] = useState<AgentChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const streamIdRef = useRef<string | null>(null);

  // Cancel an in-flight stream if the view unmounts.
  useEffect(() => {
    return () => {
      const id = streamIdRef.current;
      if (id) {
        ipc.agentOsChatStream.cancel(id);
        ipc.agentOs.chatCancel(id).catch(() => {});
      }
    };
  }, []);

  const send = () => {
    const text = input.trim();
    if (!text || streaming || !activeId) return;
    setInput("");
    const apiMessages = [
      ...messages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: text },
    ];
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    const streamId = `aos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    streamIdRef.current = streamId;
    setStreaming(true);
    setStreamingText("");
    ipc.agentOsChatStream.start(
      { streamId, agentId: activeId, messages: apiMessages },
      {
        onChunk: ({ delta }) => setStreamingText((prev) => prev + delta),
        onEnd: ({ content }) => {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: content || "(the endpoint returned an empty response)",
            },
          ]);
          setStreaming(false);
          setStreamingText("");
          streamIdRef.current = null;
        },
        onError: ({ error }) => {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: error, error: true },
          ]);
          setStreaming(false);
          setStreamingText("");
          streamIdRef.current = null;
        },
      },
    );
  };

  const stop = () => {
    const id = streamIdRef.current;
    if (id) {
      ipc.agentOsChatStream.cancel(id);
      ipc.agentOs.chatCancel(id).catch(() => {});
    }
    if (streamingText) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: streamingText },
      ]);
    }
    setStreaming(false);
    setStreamingText("");
    streamIdRef.current = null;
  };

  return { messages, input, setInput, streaming, streamingText, send, stop };
}
