/**
 * Hook for managing agent tools and their consents
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { AgentToolName } from "../pro/main/ipc/handlers/local_agent/tool_definitions";
import type { AgentTool } from "@/ipc/ipc_types";
import type { AgentToolConsent } from "@/ipc/ipc_types";

// Re-export types for convenience
export type { AgentToolName, AgentTool };

export function useAgentTools() {
  const queryClient = useQueryClient();

  const toolsQuery = useQuery({
    queryKey: ["agent-tools"],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getAgentTools();
    },
  });

  const setConsentMutation = useMutation({
    mutationFn: async (params: {
      toolName: AgentToolName;
      consent: AgentToolConsent;
    }) => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.setAgentToolConsent(params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-tools"] });
    },
  });

  return {
    tools: toolsQuery.data,
    isLoading: toolsQuery.isLoading,
    setConsent: setConsentMutation.mutateAsync,
  };
}
