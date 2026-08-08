import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useLoadAppFile(appId: number | null, filePath: string | null) {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.appFiles.content({ appId, filePath }),
    queryFn: async () => {
      return ipc.app.readAppFile({ appId: appId!, filePath: filePath! });
    },
    enabled: appId !== null && filePath !== null,
  });

  const refreshFile = () => {
    if (appId === null || filePath === null) return Promise.resolve();
    return queryClient.invalidateQueries({
      queryKey: queryKeys.appFiles.content({ appId, filePath }),
    });
  };

  return {
    content: data ?? null,
    loading: isLoading,
    error: error ?? null,
    refreshFile,
  };
}
