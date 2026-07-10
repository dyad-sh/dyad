import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import type { VersionChangedFile } from "@/ipc/types";

/**
 * Fetches only bounded changed-file metadata for a commit. File contents are
 * loaded separately for the one selected path.
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
    changes: data?.files ?? null,
    truncated: data?.truncated ?? false,
    loading: isLoading,
    error: error ?? null,
  };
}

export function useVersionFileChange(
  appId: number | null,
  versionId: string | null,
  file: VersionChangedFile | null,
) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.versions.fileChange({
      appId,
      versionId,
      filePath: file?.path ?? null,
    }),
    queryFn: async () =>
      ipc.version.getVersionFileChange({
        appId: appId!,
        versionId: versionId!,
        filePath: file!.path,
      }),
    enabled: appId !== null && versionId !== null && file !== null,
    staleTime: Infinity,
    // At most one file is displayed. Keep recently switched files briefly for
    // snappy navigation, then release their bounded content from the heap.
    gcTime: 30_000,
  });

  return {
    change: data ?? null,
    loading: isLoading,
    error: error ?? null,
  };
}
