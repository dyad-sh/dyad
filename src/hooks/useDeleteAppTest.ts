import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { showError, showSuccess } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Deletes an app's E2E spec file from disk (staged in git, not committed). On
 * success it invalidates the test list so the Tests panel drops the row.
 */
export function useDeleteAppTest() {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    { file: string },
    Error,
    { appId: number; testFile: string }
  >({
    mutationFn: ({ appId, testFile }) =>
      ipc.tests.deleteAppTest({ appId, testFile }),
    onSuccess: (result, { appId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tests.list({ appId }),
      });
      showSuccess(`Deleted ${result.file.split("/").pop() ?? result.file}`);
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
