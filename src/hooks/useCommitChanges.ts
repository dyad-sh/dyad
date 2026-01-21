import { IpcClient } from "@/ipc/ipc_client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showError, showSuccess } from "@/lib/toast";

export function useCommitChanges() {
  const queryClient = useQueryClient();

  const { mutateAsync: commitChanges, isPending: isCommitting } = useMutation({
    mutationFn: async ({
      appId,
      message,
    }: {
      appId: number;
      message: string;
    }) => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.commitChanges({ appId, message });
    },
    onSuccess: (_, { appId }) => {
      showSuccess("Changes committed successfully");
      // Invalidate uncommitted files query
      queryClient.invalidateQueries({ queryKey: ["uncommittedFiles", appId] });
      // Also invalidate versions query to update version count
      queryClient.invalidateQueries({ queryKey: ["versions", appId] });
    },
    onError: (error: Error) => {
      showError(`Failed to commit: ${error.message}`);
    },
  });

  return {
    commitChanges,
    isCommitting,
  };
}
