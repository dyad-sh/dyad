/**
 * Hook for managing agent tool consents
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";

export type Consent = "ask" | "always" | "denied";

export type AgentToolName =
  | "read_file"
  | "list_files"
  | "get_database_schema"
  | "write_file"
  | "delete_file"
  | "rename_file"
  | "search_replace"
  | "add_dependency"
  | "execute_sql"
  | "set_chat_summary";

export interface AgentTool {
  name: AgentToolName;
  description: string;
  category: "read" | "write";
}

export function useAgentTools() {
  const queryClient = useQueryClient();

  const toolsQuery = useQuery({
    queryKey: ["agent-tools"],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getAgentTools() as Promise<AgentTool[]>;
    },
  });

  const consentsQuery = useQuery({
    queryKey: ["agent-tool-consents"],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getAgentToolConsents() as Promise<Record<AgentToolName, Consent>>;
    },
  });

  const setConsentMutation = useMutation({
    mutationFn: async (params: { toolName: AgentToolName; consent: Consent }) => {
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

