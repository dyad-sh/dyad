/**
 * useAutoTTS — Auto-speak AI responses when enabled.
 * 
 * Watches for streaming completion and speaks the last assistant message.
 */

import { useRef, useEffect, useCallback } from "react";
import { atom, useAtom } from "jotai";
import { VoiceAssistantClient } from "@/ipc/voice_assistant_client";

export const autoTTSEnabledAtom = atom(false);

interface AutoTTSOptions {
  /** The full list of messages in the conversation */
  messages: Array<{ role: string; content: string }>;
  /** Whether the AI is currently streaming a response */
  streaming: boolean;
}

export function useAutoTTS({ messages, streaming }: AutoTTSOptions) {
  const [enabled, setEnabled] = useAtom(autoTTSEnabledAtom);
  const prevStreamingRef = useRef(streaming);
  const speakingRef = useRef(false);

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;

    // Trigger TTS when streaming transitions from true → false
    if (!enabled || streaming || !wasStreaming || speakingRef.current) return;

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant" || !lastMsg.content.trim()) return;

    speakingRef.current = true;
    VoiceAssistantClient.speak({ text: lastMsg.content })
      .catch(() => {}) // silently fail — TTS is best-effort
      .finally(() => { speakingRef.current = false; });
  }, [streaming, enabled, messages]);

  const toggle = useCallback(() => setEnabled((prev) => !prev), [setEnabled]);

  return { autoTTSEnabled: enabled, toggleAutoTTS: toggle };
}
