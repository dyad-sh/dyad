import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Fetches the HEAD ("before") and working-tree ("after") contents of an
 * uncommitted file so they can be rendered as a side-by-side diff.
 *
 * Working-tree content changes as the file is edited/saved, so this is not
 * cached indefinitely — it refetches on mount to reflect the latest state.
 */
export function useUncommittedFileDiff(
  appId: number | null,
  filePath: string | null,
) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.uncommittedFiles.diff({ appId, filePath }),
    queryFn: async () => {
      return ipc.git.getUncommittedFileDiff({
        appId: appId!,
        filePath: filePath!,
      });
    },
    enabled: appId !== null && filePath !== null,
    staleTime: 0,
  });

  return {
    diff: data ?? null,
    loading: isLoading,
    error: error ?? null,
  };
}
