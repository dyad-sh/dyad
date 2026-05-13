import { ipc } from "@/ipc/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showError, showSuccess } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";

export function useDiscardChanges() {
  const queryClient = useQueryClient();

  const { mutateAsync: discardChanges, isPending: isDiscarding } = useMutation({
    mutationFn: async ({ appId }: { appId: number }) => {
      return ipc.git.discardChanges({ appId });
    },
    onSuccess: (_, { appId }) => {
      showSuccess("All changes discarded");
      queryClient.invalidateQueries({
        queryKey: queryKeys.uncommittedFiles.byApp({ appId }),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId }),
      });
    },
    onError: (error: Error) => {
      showError(`Failed to discard changes: ${error.message}`);
    },
  });

  return {
    discardChanges,
    isDiscarding,
  };
}
