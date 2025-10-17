import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useAtomValue } from "jotai";

/**
 * Represents the parameters for renaming a branch.
 * @interface
 */
interface RenameBranchParams {
  /** The ID of the application. */
  appId: number;
  /** The old name of the branch. */
  oldBranchName: string;
  /** The new name of the branch. */
  newBranchName: string;
}

/**
 * A hook for renaming a branch.
 * @returns {object} An object with a function to rename a branch, and the loading and error states.
 * @property {(params: Omit<RenameBranchParams, "appId">) => Promise<void | undefined>} renameBranch - A function to rename a branch.
 * @property {boolean} isRenamingBranch - Whether the branch is being renamed.
 * @property {Error | null} renameBranchError - The error object if the renaming fails.
 */
export function useRenameBranch() {
  const queryClient = useQueryClient();
  const currentAppId = useAtomValue(selectedAppIdAtom);

  const mutation = useMutation<void, Error, RenameBranchParams>({
    mutationFn: async (params: RenameBranchParams) => {
      if (params.appId === null || params.appId === undefined) {
        throw new Error("App ID is required to rename a branch.");
      }
      if (!params.oldBranchName) {
        throw new Error("Old branch name is required.");
      }
      if (!params.newBranchName) {
        throw new Error("New branch name is required.");
      }
      await IpcClient.getInstance().renameBranch(params);
    },
    onSuccess: (_, variables) => {
      // Invalidate queries that depend on branch information
      queryClient.invalidateQueries({
        queryKey: ["currentBranch", variables.appId],
      });
      queryClient.invalidateQueries({
        queryKey: ["versions", variables.appId],
      });
      // Potentially show a success message or trigger other actions
    },
    meta: {
      showErrorToast: true,
    },
  });

  const renameBranch = async (params: Omit<RenameBranchParams, "appId">) => {
    if (!currentAppId) {
      showError("No application selected.");
      return;
    }
    return mutation.mutateAsync({ ...params, appId: currentAppId });
  };

  return {
    renameBranch,
    isRenamingBranch: mutation.isPending,
    renameBranchError: mutation.error,
  };
}
