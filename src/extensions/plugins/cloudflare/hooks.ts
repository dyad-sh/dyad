import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { CloudflareDeployment } from "./types";

// Helper to invoke extension IPC channels
// Note: This is a workaround until we have proper extension IPC client methods
function invokeExtensionChannel(channel: string, ...args: any[]): Promise<any> {
  // Access the private ipcRenderer through a type cast
  // In a real implementation, we'd add these methods to IpcClient
  const ipcClient = IpcClient.getInstance() as any;
  return ipcClient.ipcRenderer.invoke(channel, ...args);
}

/**
 * Hook for managing Cloudflare Pages deployments
 */
export function useCloudflareDeployments(appId: number) {
  const queryClient = useQueryClient();

  const {
    data: deployments = [],
    isLoading,
    error,
    refetch,
  } = useQuery<CloudflareDeployment[], Error>({
    queryKey: ["cloudflare-deployments", appId],
    queryFn: async () => {
      return invokeExtensionChannel("extension:cloudflare:list-deployments", {
        appId,
      });
    },
    enabled: false, // Don't auto-fetch, only fetch when explicitly requested
  });

  const disconnectProjectMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      return invokeExtensionChannel("extension:cloudflare:disconnect", {
        appId,
      });
    },
    onSuccess: () => {
      queryClient.removeQueries({
        queryKey: ["cloudflare-deployments", appId],
      });
    },
  });

  const getDeployments = async () => {
    return refetch();
  };

  const disconnectProject = async () => {
    return disconnectProjectMutation.mutateAsync();
  };

  return {
    deployments,
    isLoading,
    error: error?.message || null,
    getDeployments,
    disconnectProject,
    isDisconnecting: disconnectProjectMutation.isPending,
    disconnectError: disconnectProjectMutation.error?.message || null,
  };
}
