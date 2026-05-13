import { useCallback, useRef, useState } from "react";
import { useSetAtom, useStore } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { ipc } from "@/ipc/types";
import {
  selectedChatIdAtom,
  chatMessagesByIdAtom,
  isStreamingByIdAtom,
  chatStreamCountByIdAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { showError } from "@/lib/toast";
import { useChats } from "@/hooks/useChats";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useSettings } from "@/hooks/useSettings";
import { handleEffectiveChatModeChunk } from "@/lib/chatModeStream";
import { applyStreamingPatch } from "@/lib/applyStreamingPatch";
import { triggerResync, syncChatFromDb } from "@/lib/resyncChat";

interface UseResolveMergeConflictsWithAIProps {
  appId: number;
  conflicts: string[];
  onStartResolving?: () => void;
}

/**
 * Hook to resolve merge conflicts with AI by creating a new chat,
 * navigating to it, and automatically starting the conflict resolution stream.
 */
export function useResolveMergeConflictsWithAI({
  appId,
  conflicts,
  onStartResolving,
}: UseResolveMergeConflictsWithAIProps) {
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const setIsStreamingById = useSetAtom(isStreamingByIdAtom);
  const setStreamCountById = useSetAtom(chatStreamCountByIdAtom);
  const store = useStore();
  const navigate = useNavigate();
  const [isResolving, setIsResolving] = useState(false);
  const isResolvingRef = useRef(false);
  const { invalidateChats } = useChats(appId);
  const { refreshApp } = useLoadApp(appId);
  const { settings } = useSettings();

  const resolveWithAI = useCallback(async () => {
    if (!appId) {
      showError("App ID is required");
      return;
    }
    if (conflicts.length === 0) {
      showError("No conflicts to resolve");
      return;
    }
    if (isResolvingRef.current) {
      return;
    }

    isResolvingRef.current = true;
    setIsResolving(true);

    let chatId: number | null = null;
    try {
      // Create a new chat for conflict resolution
      const newChatId = await ipc.chat.createChat({
        appId,
        initialChatMode: "build",
      });
      chatId = newChatId;

      // Clear conflicts state after successful chat creation
      onStartResolving?.();

      // Build the prompt for resolving all conflicts
      const fileList = conflicts.map((f) => `- ${f}`).join("\n");
      const prompt = `Please resolve the Git merge conflicts in the following file${conflicts.length > 1 ? "s" : ""}:

${fileList}

For each file, review the conflict markers (<<<<<<<, =======, >>>>>>>) and choose the best resolution that preserves the intended functionality from both sides. Remove all conflict markers and provide the complete resolved file content.`;

      // Set up the chat state and navigate
      setSelectedChatId(newChatId);
      setSelectedAppId(appId);

      // Mark as streaming
      setIsStreamingById((prev) => {
        const next = new Map(prev);
        next.set(newChatId, true);
        return next;
      });

      // Navigate to the chat page
      navigate({
        to: "/chat",
        search: { id: newChatId },
      });

      // Start the stream
      let hasIncrementedStreamCount = false;
      ipc.chatStream.start(
        {
          chatId: newChatId,
          prompt,
        },
        {
          onChunk: ({
            messages,
            streamingMessageId,
            streamingPatch,
            effectiveChatMode,
            chatModeFallbackReason,
          }) => {
            if (
              handleEffectiveChatModeChunk(
                { effectiveChatMode, chatModeFallbackReason },
                settings,
                newChatId,
              )
            ) {
              return;
            }

            if (!hasIncrementedStreamCount) {
              setStreamCountById((prev) => {
                const next = new Map(prev);
                next.set(newChatId, (prev.get(newChatId) ?? 0) + 1);
                return next;
              });
              hasIncrementedStreamCount = true;
            }

            if (messages) {
              // Full messages update (initial load, post-compaction, etc.)
              setMessagesById((prev) => {
                const next = new Map(prev);
                next.set(newChatId, messages);
                return next;
              });
            } else if (
              streamingMessageId !== undefined &&
              streamingPatch !== undefined
            ) {
              const applied = applyStreamingPatch(
                setMessagesById,
                newChatId,
                streamingMessageId,
                streamingPatch,
              );
              if (!applied) {
                triggerResync(newChatId, setMessagesById, store);
              }
            }
          },
          onEnd: () => {
            setIsStreamingById((prev) => {
              const next = new Map(prev);
              next.set(newChatId, false);
              return next;
            });
            isResolvingRef.current = false;
            setIsResolving(false);
            invalidateChats();
            refreshApp();
            syncChatFromDb(
              newChatId,
              setMessagesById,
              "[CHAT] Merge conflict onEnd",
              store,
            );
          },
          onError: ({ error }) => {
            showError(error || "Failed to resolve conflicts");
            setIsStreamingById((prev) => {
              const next = new Map(prev);
              next.set(newChatId, false);
              return next;
            });
            isResolvingRef.current = false;
            setIsResolving(false);
            invalidateChats();
            refreshApp();
            syncChatFromDb(
              newChatId,
              setMessagesById,
              "[CHAT] Merge conflict onError",
              store,
            );
          },
        },
      );
    } catch (error: any) {
      showError(error?.message || "Failed to start conflict resolution");
      if (chatId !== null) {
        setIsStreamingById((prev) => {
          const next = new Map(prev);
          next.set(chatId!, false);
          return next;
        });
      }
      isResolvingRef.current = false;
      setIsResolving(false);
    }
  }, [
    appId,
    conflicts,
    onStartResolving,
    setSelectedChatId,
    setSelectedAppId,
    setMessagesById,
    setIsStreamingById,
    setStreamCountById,
    navigate,
    invalidateChats,
    refreshApp,
    settings,
    store,
  ]);

  return { resolveWithAI, isResolving };
}
