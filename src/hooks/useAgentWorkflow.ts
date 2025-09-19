import { useCallback, useEffect } from "react";
import { useAtom } from "jotai";
import {
  agentWorkflowAtom,
  agentWorkflowErrorAtom,
  agentWorkflowLoadingAtom,
} from "@/atoms/agentAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import type { AgentWorkflow } from "@/agents/dayd/types";

export function useAgentWorkflow(chatId?: number) {
  const [workflow, setWorkflow] = useAtom(agentWorkflowAtom);
  const [isLoading, setIsLoading] = useAtom(agentWorkflowLoadingAtom);
  const [error, setError] = useAtom(agentWorkflowErrorAtom);

  const refresh = useCallback(
    async (overrideChatId?: number) => {
      const targetChatId = overrideChatId ?? chatId;
      if (typeof targetChatId !== "number") {
        setWorkflow(null);
        setError(null);
        return null;
      }
      setIsLoading(true);
      try {
        const data = (await IpcClient.getInstance().getAgentWorkflow(
          targetChatId,
        )) as AgentWorkflow;
        setWorkflow(data);
        setError(null);
        return data;
      } catch (err) {
        console.error("Failed to load agent workflow", err);
        setError(
          err instanceof Error ? err.message : "Failed to load agent workflow",
        );
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [chatId, setError, setIsLoading, setWorkflow],
  );

  useEffect(() => {
    if (typeof chatId === "number") {
      if (workflow && workflow.chatId === chatId) {
        return;
      }
      void refresh(chatId);
    } else {
      setWorkflow(null);
      setError(null);
    }
  }, [chatId, workflow, refresh, setWorkflow, setError]);

  const setAutoAdvance = useCallback(
    async (enabled: boolean) => {
      if (typeof chatId !== "number") return null;
      setIsLoading(true);
      try {
        const updated =
          await IpcClient.getInstance().setAgentAutoAdvance(chatId, enabled);
        setWorkflow(updated);
        setError(null);
        return updated;
      } catch (err) {
        console.error("Failed to update auto-advance", err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to update auto-advance",
        );
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [chatId, setError, setIsLoading, setWorkflow],
  );

  return {
    workflow,
    isLoading,
    error,
    refresh,
    setAutoAdvance,
  };
}
