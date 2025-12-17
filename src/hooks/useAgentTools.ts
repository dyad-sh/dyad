/**
 * Hook for managing agent tool consents
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type {
  Consent,
  AgentToolName,
} from "@/ipc/handlers/local_agent/tool_definitions";
import type { AgentTool } from "@/ipc/ipc_types";

// Re-export types for convenience
export type { Consent, AgentToolName, AgentTool };

export function useAgentTools() {
  const queryClient = useQueryClient();

  const toolsQuery = useQuery({
    queryKey: ["agent-tools"],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getAgentTools();
    },
  });

  const consentsQuery = useQuery({
    queryKey: ["agent-tool-consents"],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getAgentToolConsents() as Promise<
        Record<AgentToolName, Consent>
      >;
    },
  });

  const setConsentMutation = useMutation({
    mutationFn: async (params: {
      toolName: AgentToolName;
      consent: Consent;
    }) => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.setAgentToolConsent(params.toolName, params.consent);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-tool-consents"] });
    },
  });

  return {
    tools: toolsQuery.data,
    consents: consentsQuery.data,
    isLoading: toolsQuery.isLoading || consentsQuery.isLoading,
    setConsent: setConsentMutation.mutateAsync,
  };
}
