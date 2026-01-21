import { ipc, type BranchResult } from "@/ipc/types";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function useCurrentBranch(appId: number | null) {
  const {
    data: branchInfo,
    isLoading,
    refetch: refetchBranchInfo,
  } = useQuery<BranchResult, Error>({
    queryKey: queryKeys.branches.current({ appId }),
    queryFn: async (): Promise<BranchResult> => {
      if (appId === null) {
        // This case should ideally be handled by the `enabled` option
        // but as a safeguard, and to ensure queryFn always has a valid appId if called.
        throw new Error("appId is null, cannot fetch current branch.");
      }
      return ipc.version.getCurrentBranch({ appId });
    },
    enabled: appId !== null,
    meta: { showErrorToast: true },
  });

  return {
    branchInfo,
    isLoading,
    refetchBranchInfo,
  };
}
