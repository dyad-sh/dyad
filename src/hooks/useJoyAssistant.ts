/**
 * useJoyAssistant — TanStack Query + streaming hooks for the Joy Assistant.
 */

import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { atom, useAtom } from "jotai";
import { JoyAssistantClient } from "@/ipc/joy_assistant_client";
import type {
  AssistantAction,
  AssistantMessage,
  AssistantMode,
  AssistantPageContext,
} from "@/types/joy_assistant_types";

// ── Jotai atoms for global panel state ─────────────────────────────────────

export const assistantPanelOpenAtom = atom(false);
export const assistantModeAtom = atom<AssistantMode>("auto");

// ── Query keys ─────────────────────────────────────────────────────────────

const assistantKeys = {
  all: ["joy-assistant"] as const,
  suggestions: (route: string) =>
    [...assistantKeys.all, "suggestions", route] as const,
  history: (sessionId: string) =>
    [...assistantKeys.all, "history", sessionId] as const,
};

// ── Suggestions hook ───────────────────────────────────────────────────────

export function useAssistantSuggestions(pageContext: AssistantPageContext | null) {
  return useQuery({
    queryKey: assistantKeys.suggestions(pageContext?.route ?? ""),
    queryFn: () =>
      JoyAssistantClient.getInstance().getSuggestions(pageContext!),
    enabled: !!pageContext?.route,
    staleTime: 30_000,
  });
}

// ── History hook ───────────────────────────────────────────────────────────

export function useAssistantHistory(sessionId: string) {
  return useQuery({
    queryKey: assistantKeys.history(sessionId),
    queryFn: () => JoyAssistantClient.getInstance().getHistory(sessionId),
    enabled: !!sessionId,
  });
}

// ── Panel toggle hook ──────────────────────────────────────────────────────

export function useAssistantPanel() {
  const [open, setOpen] = useAtom(assistantPanelOpenAtom);
  const toggle = useCallback(() => setOpen((v) => !v), [setOpen]);
  return { open, setOpen, toggle } as const;
}

// ── Mode hook ──────────────────────────────────────────────────────────────

export function useAssistantMode() {
  const [mode, setMode] = useAtom(assistantModeAtom);
  return { mode, setMode } as const;
}

// ── Main streaming chat hook ───────────────────────────────────────────────

export function useJoyAssistant(sessionId: string) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [pendingActions, setPendingActions] = useState<AssistantAction[]>([]);
  const contentRef = useRef("");
  const [mode] = useAtom(assistantModeAtom);

  const sendMessage = useCallback(
    (text: string, pageContext: AssistantPageContext) => {
      if (!text.trim() || streaming) return;

      // Append user message immediately
      const userMsg: AssistantMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setStreaming(true);
      contentRef.current = "";

      // Create a placeholder for the assistant response
      const assistantId = crypto.randomUUID();
      const assistantMsg: AssistantMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      JoyAssistantClient.getInstance().chat(
        { sessionId, message: text, pageContext, mode },
        {
          onDelta: (delta) => {
            contentRef.current += delta;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: contentRef.current }
                  : m,
              ),
            );
          },
          onActions: (actions) => {
            setPendingActions(actions);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, actions } : m,
              ),
            );
          },
          onEnd: () => {
            setStreaming(false);
            queryClient.invalidateQueries({
              queryKey: assistantKeys.history(sessionId),
            });
          },
          onError: (error) => {
            setStreaming(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: `Error: ${error}` }
                  : m,
              ),
            );
          },
        },
      );
    },
    [sessionId, streaming, mode, queryClient],
  );

  const cancel = useCallback(() => {
    JoyAssistantClient.getInstance().cancel(sessionId);
    setStreaming(false);
  }, [sessionId]);

  const clearHistory = useCallback(async () => {
    await JoyAssistantClient.getInstance().clearHistory(sessionId);
    setMessages([]);
    setPendingActions([]);
    queryClient.invalidateQueries({
      queryKey: assistantKeys.history(sessionId),
    });
  }, [sessionId, queryClient]);

  const executeAction = useCallback(
    async (action: AssistantAction) => {
      const response = await JoyAssistantClient.getInstance().executeAction(sessionId, action);
      // If the action returned a result (system actions), append it to the chat
      if (response.result !== undefined) {
        const resultText = typeof response.result === "string"
          ? response.result
          : JSON.stringify(response.result, null, 2);
        const resultMsg: AssistantMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `\`\`\`\n${resultText}\n\`\`\``,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, resultMsg]);
      }
      return response;
    },
    [sessionId],
  );

  const dismissActions = useCallback(() => {
    setPendingActions([]);
  }, []);

  return {
    messages,
    streaming,
    pendingActions,
    sendMessage,
    cancel,
    clearHistory,
    executeAction,
    dismissActions,
  } as const;
}
