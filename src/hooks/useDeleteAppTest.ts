import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { showError, showSuccess } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Deletes an app's E2E spec file from disk and commits that deletion on its
 * own. On success it invalidates the test list so the Tests panel drops the
 * row, the version list so the new commit shows up, and the uncommitted-files
 * query since the app's pending-changes count just changed.
 */
export function useDeleteAppTest() {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    {
      file: string;
      committed: boolean;
      uncommittedReason: "untracked" | "commit-failed" | null;
    },
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
        queryKey: queryKeys.versions.list({ appId }),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.uncommittedFiles.byApp({ appId }),
      });
      const fileName = result.file.split("/").pop() ?? result.file;
      // Recovery guidance differs by why nothing was committed: an untracked
      // file is gone for good, while a failed commit leaves the deletion staged
      // in pending changes. Don't promise recovery we can't keep, and don't
      // call a recoverable deletion unrecoverable either.
      showSuccess(
        result.uncommittedReason === "untracked"
          ? `Deleted ${fileName} (was untracked, not recoverable)`
          : result.uncommittedReason === "commit-failed"
            ? `Deleted ${fileName} (not committed — see pending changes)`
            : `Deleted ${fileName}`,
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
