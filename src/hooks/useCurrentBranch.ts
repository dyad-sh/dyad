import { IpcClient } from "@/ipc/ipc_client";
import { useQuery } from "@tanstack/react-query";
import type { BranchResult } from "@/ipc/ipc_types";

/**
 * A hook for getting the current branch of an app.
 * @param {number | null} appId - The ID of the app.
 * @returns {object} An object with the branch info, loading state, and a function to refetch the branch info.
 * @property {BranchResult | undefined} branchInfo - The branch info.
 * @property {boolean} isLoading - Whether the branch info is being loaded.
 * @property {() => void} refetchBranchInfo - A function to refetch the branch info.
 */
export function useCurrentBranch(appId: number | null) {
  const {
    data: branchInfo,
    isLoading,
    refetch: refetchBranchInfo,
  } = useQuery<BranchResult, Error>({
    queryKey: ["currentBranch", appId],
    queryFn: async (): Promise<BranchResult> => {
      if (appId === null) {
        // This case should ideally be handled by the `enabled` option
        // but as a safeguard, and to ensure queryFn always has a valid appId if called.
        throw new Error("appId is null, cannot fetch current branch.");
      }
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getCurrentBranch(appId);
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
