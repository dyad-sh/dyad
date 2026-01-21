import { ipc } from "@/ipc/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showError, showSuccess } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";

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
      return ipc.git.commitChanges({ appId, message });
    },
    onSuccess: (_, { appId }) => {
      showSuccess("Changes committed successfully");
      // Invalidate uncommitted files query
      queryClient.invalidateQueries({
        queryKey: queryKeys.uncommittedFiles.byApp({ appId }),
      });
      // Also invalidate versions query to update version count
      queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId }),
      });
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
