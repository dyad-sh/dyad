import { IpcClient } from "@/ipc/ipc_client";
import type { AppFileSearchResult } from "@/ipc/ipc_types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

export function useSearchAppFiles(appId: number | null, query: string) {
  const trimmedQuery = query.trim();
  const enabled = Boolean(appId && trimmedQuery.length > 0);

  const { data, isFetching, isLoading, error } = useQuery({
    queryKey: ["search-app-files", appId, trimmedQuery],
    enabled,
    queryFn: async (): Promise<AppFileSearchResult[]> => {
      if (!appId) {
        return [];
      }
      return IpcClient.getInstance().searchAppFiles(appId, trimmedQuery);
    },
    placeholderData: keepPreviousData,
    retry: 0,
  });

  return {
    results: data ?? [],
    loading: enabled ? isFetching || isLoading : false,
    error: enabled ? error : null,
  };
}
