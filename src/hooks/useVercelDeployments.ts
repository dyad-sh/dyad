import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { VercelDeployment } from "@/ipc/ipc_types";

/**
 * A hook for managing Vercel deployments.
 * @param {number} appId - The ID of the app.
 * @returns {object} An object with the list of deployments, loading state, error, and functions to manage deployments.
 * @property {VercelDeployment[]} deployments - The list of deployments.
 * @property {boolean} isLoading - Whether the deployments are being loaded.
 * @property {string | null} error - The error message if the query fails.
 * @property {() => Promise<any>} getDeployments - A function to fetch the deployments.
 * @property {() => Promise<void>} disconnectProject - A function to disconnect the project.
 * @property {boolean} isDisconnecting - Whether the project is being disconnected.
 * @property {string | null} disconnectError - The error message if the disconnection fails.
 */
export function useVercelDeployments(appId: number) {
  const queryClient = useQueryClient();

  const {
    data: deployments = [],
    isLoading,
    error,
    refetch,
  } = useQuery<VercelDeployment[], Error>({
    queryKey: ["vercel-deployments", appId],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getVercelDeployments({ appId });
    },
    // enabled: false, // Don't auto-fetch, only fetch when explicitly requested
  });

  const disconnectProjectMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.disconnectVercelProject({ appId });
    },
    onSuccess: () => {
      // Clear deployments cache when project is disconnected
      queryClient.removeQueries({ queryKey: ["vercel-deployments", appId] });
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
