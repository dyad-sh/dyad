import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useAtomValue } from "jotai";
import { queryKeys } from "@/lib/queryKeys";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

interface RenameBranchParams {
  appId: number;
  oldBranchName: string;
  newBranchName: string;
}

export function useRenameBranch() {
  const queryClient = useQueryClient();
  const currentAppId = useAtomValue(selectedAppIdAtom);

  const mutation = useMutation<void, Error, RenameBranchParams>({
    mutationFn: async (params: RenameBranchParams) => {
      if (params.appId === null || params.appId === undefined) {
        throw new DyadError(
          "App ID is required to rename a branch.",
          DyadErrorKind.Validation,
        );
      }
      if (!params.oldBranchName) {
        throw new DyadError(
          "Old branch name is required.",
          DyadErrorKind.Validation,
        );
      }
      if (!params.newBranchName) {
        throw new DyadError(
          "New branch name is required.",
          DyadErrorKind.Validation,
        );
      }
      await ipc.app.renameBranch(params);
    },
    onSuccess: (_, variables) => {
      // Invalidate queries that depend on branch information
      queryClient.invalidateQueries({
        queryKey: queryKeys.branches.current({ appId: variables.appId }),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId: variables.appId }),
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
