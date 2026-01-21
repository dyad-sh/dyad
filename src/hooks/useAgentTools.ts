/**
 * Hook for managing agent tools and their consents
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { AgentToolName } from "../pro/main/ipc/handlers/local_agent/tool_definitions";
import type { AgentTool } from "@/ipc/types";
import { AgentToolConsent } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";

// Re-export types for convenience
export type { AgentToolName, AgentTool };

export function useAgentTools() {
  const queryClient = useQueryClient();

  const toolsQuery = useQuery({
    queryKey: queryKeys.agentTools.all,
    queryFn: async () => {
      return ipc.agent.getTools();
    },
  });

  const setConsentMutation = useMutation({
    mutationFn: async (params: {
      toolName: AgentToolName;
      consent: AgentToolConsent;
    }) => {
      return ipc.agent.setConsent(params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agentTools.all });
    },
  });

  return {
    tools: toolsQuery.data,
    isLoading: toolsQuery.isLoading,
    setConsent: setConsentMutation.mutateAsync,
  };
}
