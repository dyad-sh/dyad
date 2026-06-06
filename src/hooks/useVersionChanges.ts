import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Fetches the list of files changed in a specific version (commit), along with
 * the old (parent) and new content for each, so they can be rendered as diffs.
 *
 * Commit content is immutable, so results are cached indefinitely.
 */
export function useVersionChanges(
  appId: number | null,
  versionId: string | null,
) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.versions.changes({ appId, versionId }),
    queryFn: async () => {
      return ipc.version.getVersionChanges({
        appId: appId!,
        versionId: versionId!,
      });
    },
    enabled: appId !== null && versionId !== null,
    staleTime: Infinity,
  });

  return {
    changes: data ?? null,
    loading: isLoading,
    error: error ?? null,
  };
}
