import { useCallback, useRef } from "react";
import type {
  ComponentSelection,
  Message,
  FileAttachment,
} from "@/ipc/ipc_types";
import { useAtom, useSetAtom } from "jotai";
import { agentWorkflowAtom, agentWorkflowErrorAtom, agentWorkflowLoadingAtom } from "@/atoms/agentAtoms";
import {
  chatErrorAtom,
  chatMessagesAtom,
  chatStreamCountAtom,
  isStreamingAtom,
} from "@/atoms/chatAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import type { ChatResponseEnd } from "@/ipc/ipc_types";
import { useChats } from "./useChats";
import { useLoadApp } from "./useLoadApp";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useVersions } from "./useVersions";
import { showExtraFilesToast } from "@/lib/toast";
import { useProposal } from "./useProposal";
import { useSearch } from "@tanstack/react-router";
import { useRunApp } from "./useRunApp";
import { useCountTokens } from "./useCountTokens";
import { useUserBudgetInfo } from "./useUserBudgetInfo";
import { usePostHog } from "posthog-js/react";
import { useCheckProblems } from "./useCheckProblems";
import { useSettings } from "./useSettings";

export function getRandomNumberId() {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

export function useStreamChat({
  hasChatId = true,
}: { hasChatId?: boolean } = {}) {
  const [, setMessages] = useAtom(chatMessagesAtom);
  const [isStreaming, setIsStreaming] = useAtom(isStreamingAtom);
  const [error, setError] = useAtom(chatErrorAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const { refreshChats } = useChats(selectedAppId);
  const { refreshApp } = useLoadApp(selectedAppId);
  const setStreamCount = useSetAtom(chatStreamCountAtom);
  const setAgentWorkflow = useSetAtom(agentWorkflowAtom);
  const setAgentWorkflowLoading = useSetAtom(agentWorkflowLoadingAtom);
  const setAgentWorkflowError = useSetAtom(agentWorkflowErrorAtom);
  const { refreshVersions } = useVersions(selectedAppId);
  const { refreshAppIframe } = useRunApp();
  const { countTokens } = useCountTokens();
  const { refetchUserBudget } = useUserBudgetInfo();
  const { checkProblems } = useCheckProblems(selectedAppId);
  const { settings } = useSettings();
  const posthog = usePostHog();
  const abortControllerRef = useRef<AbortController | null>(null);
  let chatId: number | undefined;

  if (hasChatId) {
    const { id } = useSearch({ from: "/chat" });
    chatId = id;
  }
  let { refreshProposal } = hasChatId ? useProposal(chatId) : useProposal();

  const streamMessage = useCallback(
    async ({
      prompt,
      chatId,
      redo,
      attachments,
      selectedComponent,
    }: {
      prompt: string;
      chatId: number;
      redo?: boolean;
      attachments?: FileAttachment[];
      selectedComponent?: ComponentSelection | null;
    }) => {
      if (
        (!prompt.trim() && (!attachments || attachments.length === 0)) ||
        !chatId
      ) {
        return;
      }

      setError(null);
      setIsStreaming(true);

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      let hasIncrementedStreamCount = false;
      try {
        IpcClient.getInstance().streamMessage(prompt, {
          selectedComponent: selectedComponent ?? null,
          chatId,
          redo,
          attachments,
          onUpdate: (updatedMessages: Message[]) => {
            if (!hasIncrementedStreamCount) {
              setStreamCount((streamCount) => streamCount + 1);
              hasIncrementedStreamCount = true;
            }

            setMessages(updatedMessages);
          },
          onEnd: (response: ChatResponseEnd) => {
            if (response.updatedFiles) {
              setIsPreviewOpen(true);
              refreshAppIframe();
              if (settings?.enableAutoFixProblems) {
                checkProblems();
              }
            }
            if (response.extraFiles) {
              showExtraFilesToast({
                files: response.extraFiles,
                error: response.extraFilesError,
                posthog,
              });
            }
            refreshProposal(chatId);

            refetchUserBudget();

            // Keep the same as below
            setIsStreaming(false);
            refreshChats();
            refreshApp();
            refreshVersions();
            countTokens(chatId, "");
            if (
              response.agent &&
              settings?.selectedChatMode === "agent" &&
              chatId
            ) {
              setAgentWorkflowLoading(true);
              IpcClient.getInstance()
                .refreshAgentWorkflow(chatId)
                .then((workflow) => {
                  setAgentWorkflow(workflow);
                  setAgentWorkflowError(null);
                })
                .catch((err) => {
                  console.error("Failed to refresh agent workflow", err);
                  setAgentWorkflowError(
                    err instanceof Error
                      ? err.message
                      : "Failed to refresh agent workflow",
                  );
                })
                .finally(() => {
                  setAgentWorkflowLoading(false);
                });
            }
            if (
              response.agent?.shouldAutoContinue &&
              settings?.selectedChatMode === "agent" &&
              chatId &&
              !abortController.signal.aborted
            ) {
              setTimeout(() => {
                streamMessage({
                  prompt: "continue",
                  chatId,
                  redo: false,
                  selectedComponent: null,
                });
              }, 200);
            }
            if (abortControllerRef.current === abortController) {
              abortControllerRef.current = null;
            }
          },
          onError: (errorMessage: string) => {
            console.error(`[CHAT] Stream error for ${chatId}:`, errorMessage);
            setError(errorMessage);
            if (abortControllerRef.current === abortController) {
              abortControllerRef.current = null;
            }

            // Keep the same as above
            setIsStreaming(false);
            refreshChats();
            refreshApp();
            refreshVersions();
            countTokens(chatId, "");
          },
        });
      } catch (error) {
        console.error("[CHAT] Exception during streaming setup:", error);
        setIsStreaming(false);
        setError(error instanceof Error ? error.message : String(error));
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      setMessages,
      setIsStreaming,
      setIsPreviewOpen,
      checkProblems,
      selectedAppId,
      refetchUserBudget,
      settings,
      setAgentWorkflow,
      setAgentWorkflowError,
      setAgentWorkflowLoading,
    ],
  );

  const cancelStream = useCallback(
    (cancelChatId?: number) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (cancelChatId) {
        IpcClient.getInstance().cancelChatStream(cancelChatId);
      }
      setIsStreaming(false);
    },
    [setIsStreaming],
  );

  return {
    streamMessage,
    isStreaming,
    error,
    setError,
    cancelStream,
    setIsStreaming,
  };
}

