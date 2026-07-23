import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export interface GithubBranchInventory {
  readonly branches: readonly string[];
  readonly currentBranch: string | null;
}

export function useGithubBranchInventory(appId: number) {
  return useQuery<GithubBranchInventory, Error>({
    queryKey: queryKeys.branches.inventory({ appId }),
    queryFn: async () => {
      const [local, remote] = await Promise.all([
        ipc.github.listLocalBranches({ appId }),
        ipc.github.listRemoteBranches({ appId }).catch(() => []),
      ]);

      return {
        branches: Array.from(new Set([...local.branches, ...remote])).sort(),
        currentBranch: local.current || null,
      };
    },
    meta: { showErrorToast: true },
  });
}
