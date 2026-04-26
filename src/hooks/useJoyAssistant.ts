/**
 * useJoyAssistant — TanStack Query + streaming hooks for the Joy Assistant.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
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
/** Currently selected session ID. `null` means a freshly-generated UUID is used. */
export const assistantActiveSessionAtom = atom<string | null>(null);

// ── Query keys ─────────────────────────────────────────────────────────────

const assistantKeys = {
  all: ["joy-assistant"] as const,
  suggestions: (route: string) =>
    [...assistantKeys.all, "suggestions", route] as const,
  history: (sessionId: string) =>
    [...assistantKeys.all, "history", sessionId] as const,
  sessions: () => [...assistantKeys.all, "sessions"] as const,
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

  // Load persisted history when the session changes
  const { data: persistedHistory } = useQuery({
    queryKey: assistantKeys.history(sessionId),
    queryFn: () => JoyAssistantClient.getInstance().getHistory(sessionId),
    enabled: !!sessionId,
    staleTime: 5_000,
  });

  // Hydrate local messages from persisted history when it loads / session switches
  const lastLoadedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (persistedHistory && lastLoadedSessionRef.current !== sessionId) {
      lastLoadedSessionRef.current = sessionId;
      setMessages(persistedHistory);
      setPendingActions([]);
    }
  }, [persistedHistory, sessionId]);

  const startStream = useCallback(
    (
      assistantId: string,
      invoke: (callbacks: Parameters<typeof JoyAssistantClient.prototype.chat>[1]) => void,
    ) => {
      setStreaming(true);
      contentRef.current = "";
      invoke({
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
            prev.map((m) => (m.id === assistantId ? { ...m, actions } : m)),
          );
        },
        onEnd: () => {
          setStreaming(false);
          queryClient.invalidateQueries({
            queryKey: assistantKeys.history(sessionId),
          });
          queryClient.invalidateQueries({
            queryKey: assistantKeys.sessions(),
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
      });
    },
    [sessionId, queryClient],
  );

  const sendMessage = useCallback(
    (text: string, pageContext: AssistantPageContext) => {
      if (!text.trim() || streaming) return;

      const userMsg: AssistantMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      const assistantId = crypto.randomUUID();
      const assistantMsg: AssistantMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      startStream(assistantId, (cb) =>
        JoyAssistantClient.getInstance().chat(
          { sessionId, message: text, pageContext, mode },
          cb,
        ),
      );
    },
    [sessionId, streaming, mode, startStream],
  );

  const regenerate = useCallback(
    (pageContext: AssistantPageContext) => {
      if (streaming) return;
      // Drop the trailing assistant message locally; server will re-stream.
      setMessages((prev) => {
        const next = [...prev];
        if (next.length && next[next.length - 1].role === "assistant") {
          next.pop();
        }
        return next;
      });
      const assistantId = crypto.randomUUID();
      const assistantMsg: AssistantMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      startStream(assistantId, (cb) =>
        JoyAssistantClient.getInstance().regenerate(
          { sessionId, pageContext, mode },
          cb,
        ),
      );
    },
    [sessionId, streaming, mode, startStream],
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
    queryClient.invalidateQueries({ queryKey: assistantKeys.sessions() });
  }, [sessionId, queryClient]);

  const executeAction = useCallback(
    async (action: AssistantAction) => {
      const response = await JoyAssistantClient.getInstance().executeAction(sessionId, action);
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
    regenerate,
    cancel,
    clearHistory,
    executeAction,
    dismissActions,
  } as const;
}

// ── Multi-session hooks ────────────────────────────────────────────────────

export function useAssistantSessions() {
  return useQuery({
    queryKey: assistantKeys.sessions(),
    queryFn: () => JoyAssistantClient.getInstance().listSessions(),
    staleTime: 5_000,
  });
}

export function useDeleteAssistantSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      JoyAssistantClient.getInstance().deleteSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: assistantKeys.sessions() });
    },
  });
}

export function useRenameAssistantSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      JoyAssistantClient.getInstance().renameSession(sessionId, title),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: assistantKeys.sessions() });
    },
  });
}

export function useActiveAssistantSession() {
  return useAtom(assistantActiveSessionAtom);
}
