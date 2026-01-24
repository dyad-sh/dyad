import { ipc, type UncommittedFile } from "@/ipc/types";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export type { UncommittedFile };

export function useUncommittedFiles(appId: number | null) {
  const {
    data: uncommittedFiles,
    isLoading,
    refetch: refetchUncommittedFiles,
  } = useQuery<UncommittedFile[], Error>({
    queryKey: queryKeys.uncommittedFiles.byApp({ appId }),
    queryFn: async (): Promise<UncommittedFile[]> => {
      if (appId === null) {
        throw new Error("appId is null, cannot fetch uncommitted files.");
      }
      return ipc.git.getUncommittedFiles({ appId });
    },
    enabled: appId !== null,
    // Refetch every 5 seconds to keep the status updated
    refetchInterval: 5000,
  });

  return {
    uncommittedFiles: uncommittedFiles ?? [],
    hasUncommittedFiles: (uncommittedFiles?.length ?? 0) > 0,
    isLoading,
    refetchUncommittedFiles,
  };
}
