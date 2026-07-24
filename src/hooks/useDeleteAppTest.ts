import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { showError, showSuccess } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Deletes an app's E2E spec file from disk (staged in git, not committed). On
 * success it invalidates the test list so the Tests panel drops the row, and
 * the uncommitted-files query so the staged deletion shows up in the Changes
 * diff immediately.
 */
export function useDeleteAppTest() {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    { file: string; staged: boolean },
    Error,
    { appId: number; testFile: string }
  >({
    mutationFn: ({ appId, testFile }) =>
      ipc.tests.deleteAppTest({ appId, testFile }),
    onSuccess: (result, { appId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tests.list({ appId }),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.uncommittedFiles.byApp({ appId }),
      });
      const fileName = result.file.split("/").pop() ?? result.file;
      // Only a tracked file leaves a staged deletion behind to restore from; an
      // untracked file is gone for good, so don't promise recovery we can't keep.
      showSuccess(
        result.staged
          ? `Deleted ${fileName}`
          : `Deleted ${fileName} (was untracked, not recoverable)`,
      );
    },
    onError: (error) => {
      showError(error.message || "Failed to delete test");
    },
  });

  return {
    deleteTest: mutation.mutate,
    deleteTestAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
}
