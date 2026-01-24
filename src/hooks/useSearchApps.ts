import { ipc } from "@/ipc/types";
import { AppSearchResult } from "@/lib/schemas";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function useSearchApps(query: string) {
  const enabled = Boolean(query && query.trim().length > 0);

  const { data, isFetching, isLoading } = useQuery({
    queryKey: queryKeys.apps.search({ query }),
    enabled,
    queryFn: async (): Promise<AppSearchResult[]> => {
      return ipc.app.searchApps(query);
    },
    placeholderData: keepPreviousData,
    retry: 0,
  });

  return {
    apps: data ?? [],
    loading: enabled ? isFetching || isLoading : false,
  };
}
