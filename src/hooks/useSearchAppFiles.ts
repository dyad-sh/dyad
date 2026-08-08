import { ipc } from "@/ipc/types";
import type { AppFileSearchResult } from "@/ipc/types";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function useSearchAppFiles(appId: number | null, query: string) {
  const trimmedQuery = query.trim();
  const enabled = Boolean(appId != null && trimmedQuery.length > 0);

  const { data, isFetching, isLoading, error } = useQuery({
    queryKey: queryKeys.files.search({ appId, query: trimmedQuery }),
    enabled,
    queryFn: async (): Promise<AppFileSearchResult[]> => {
      return ipc.app.searchAppFiles({ appId: appId!, query: trimmedQuery });
    },
  });

  return {
    results: data ?? [],
    loading: enabled ? isFetching || isLoading : false,
    error: enabled ? error : null,
  };
}
