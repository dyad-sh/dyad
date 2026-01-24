import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc, type VercelDeployment } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useVercelDeployments(appId: number) {
  const queryClient = useQueryClient();

  const {
    data: deployments = [],
    isLoading,
    error,
    refetch,
  } = useQuery<VercelDeployment[], Error>({
    queryKey: queryKeys.vercel.deployments({ appId }),
    queryFn: async () => {
      return ipc.vercel.getDeployments({ appId });
    },
    // enabled: false, // Don't auto-fetch, only fetch when explicitly requested
  });

  const disconnectProjectMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      return ipc.vercel.disconnect({ appId });
    },
    onSuccess: () => {
      // Clear deployments cache when project is disconnected
      queryClient.removeQueries({
        queryKey: queryKeys.vercel.deployments({ appId }),
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
