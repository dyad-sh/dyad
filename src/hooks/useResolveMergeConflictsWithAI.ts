import { useCallback, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { ipc } from "@/ipc/types";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useChatStreamManager } from "@/chat_stream/ChatStreamProvider";
import { showError } from "@/lib/toast";
import { useChats } from "@/hooks/useChats";
import { useLoadApp } from "@/hooks/useLoadApp";

interface UseResolveMergeConflictsWithAIProps {
  appId: number;
  conflicts: readonly string[];
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
  const navigate = useNavigate();
  const [isResolving, setIsResolving] = useState(false);
  const isResolvingRef = useRef(false);
  const { invalidateChats } = useChats(appId);
  const { refreshApp } = useLoadApp(appId);
  const chatStreamManager = useChatStreamManager();

  const resolveFilesWithAI = useCallback(
    async (requestedConflicts: readonly string[]) => {
      if (!appId) {
        showError("App ID is required");
        return;
      }
      if (requestedConflicts.length === 0) {
        showError("No conflicts to resolve");
        return;
      }
      if (isResolvingRef.current) {
        return;
      }

      isResolvingRef.current = true;
      setIsResolving(true);

      try {
        // Create a new chat for conflict resolution
        const newChatId = await ipc.chat.createChat({
          appId,
          initialChatMode: "build",
        });
        // Clear conflicts state after successful chat creation
        onStartResolving?.();

        // Build the prompt for resolving all conflicts
        const fileList = requestedConflicts.map((f) => `- ${f}`).join("\n");
        const prompt = `Please resolve the Git merge conflicts in the following file${requestedConflicts.length > 1 ? "s" : ""}:

${fileList}

For each file, review the conflict markers (<<<<<<<, =======, >>>>>>>) and choose the best resolution that preserves the intended functionality from both sides. Remove all conflict markers and provide the complete resolved file content.`;

        // Set up the chat state and navigate
        setSelectedChatId(newChatId);
        setSelectedAppId(appId);

        // Navigate to the chat page
        navigate({
          to: "/chat",
          search: { id: newChatId },
        });

        chatStreamManager.ensure(newChatId).send({
          type: "submit",
          request: {
            chatId: newChatId,
            prompt,
            appId,
            onSettled: () => {
              isResolvingRef.current = false;
              setIsResolving(false);
              invalidateChats();
              void refreshApp();
            },
          },
        });
      } catch (error: unknown) {
        showError(
          error instanceof Error
            ? error.message
            : "Failed to start conflict resolution",
        );
        isResolvingRef.current = false;
        setIsResolving(false);
      }
    },
    [
      appId,
      onStartResolving,
      setSelectedChatId,
      setSelectedAppId,
      navigate,
      invalidateChats,
      refreshApp,
      chatStreamManager,
    ],
  );

  const resolveWithAI = useCallback(
    () => resolveFilesWithAI(conflicts),
    [conflicts, resolveFilesWithAI],
  );

  return { resolveWithAI, resolveFilesWithAI, isResolving };
}
