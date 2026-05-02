/**
 * useEnsureN8nMcpTrigger
 * --------------------------------------------------------------------------
 * React-Query mutation wrapper for the `n8n:ensure-mcp-trigger` IPC channel.
 *
 * Calling `ensureN8nMcpTrigger.mutateAsync({...})` from the MCP Hub install
 * flow (or anywhere else that wants an MCP Server Trigger workflow live in
 * n8n) provisions / activates the workflow on the local n8n instance and
 * returns the SSE URL to connect to.
 *
 * On success we invalidate the MCP server lists so any UI that depends on
 * `["mcp", "servers"]` or `["mcp", "statuses"]` re-fetches and reflects the
 * newly available trigger immediately.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";

export interface EnsureN8nMcpTriggerParams {
  path?: string;
  name?: string;
  apiKey?: string;
}

export interface EnsureN8nMcpTriggerResult {
  url: string;
  workflowId: string;
  workflowName: string;
  created: boolean;
}

export function useEnsureN8nMcpTrigger() {
  const queryClient = useQueryClient();
  return useMutation<EnsureN8nMcpTriggerResult, Error, EnsureN8nMcpTriggerParams>({
    mutationFn: async (params: EnsureN8nMcpTriggerParams) => {
      return IpcClient.getInstance().ensureN8nMcpTrigger(params);
    },
    onSuccess: () => {
      // Refresh anything that depends on the MCP server list / statuses
      // so the just-provisioned trigger is reflected in the UI.
      queryClient.invalidateQueries({ queryKey: ["mcp", "servers"] });
      queryClient.invalidateQueries({ queryKey: ["mcp", "statuses"] });
    },
    onError: (err) => {
      // n8n provisioning can fail for lots of reasons (n8n not running,
      // wrong API key, network). Surface the error so the user knows the
      // trigger wasn't actually created instead of failing silently.
      const msg = err instanceof Error ? err.message : String(err);
      showError(`Failed to provision n8n MCP trigger: ${msg}`);
    },
  });
}
