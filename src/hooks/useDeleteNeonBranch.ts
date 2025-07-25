import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { DeleteNeonBranchParams } from "@/ipc/ipc_types";
import { showError } from "@/lib/toast";

export const useDeleteNeonBranch = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (params: DeleteNeonBranchParams) => {
      const ipcClient = IpcClient.getInstance();
      return await ipcClient.deleteNeonBranch(params);
    },
    onSuccess: (_, variables) => {
      // Invalidate the Neon project query to refresh the branches list
      queryClient.invalidateQueries({
        queryKey: ["neon-project", variables.appId],
      });
    },
    onError: (error: Error) => {
      showError(error);
    },
  });

  const deleteNeonBranch = async (params: DeleteNeonBranchParams) => {
    return mutation.mutateAsync(params);
  };

  return {
    deleteNeonBranch,
    isDeleting: mutation.isPending,
    error: mutation.error,
  };
};
