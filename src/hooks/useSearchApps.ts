import { IpcClient } from "@/ipc/ipc_client";
import { AppSearchResult } from "@/lib/schemas";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

/**
 * A hook for searching apps.
 * @param {string} query - The search query.
 * @returns {object} An object with the list of apps and the loading state.
 * @property {AppSearchResult[]} apps - The list of apps that match the query.
 * @property {boolean} loading - Whether the search is in progress.
 */
export function useSearchApps(query: string) {
  const enabled = Boolean(query && query.trim().length > 0);

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ["search-apps", query],
    enabled,
    queryFn: async (): Promise<AppSearchResult[]> => {
      return IpcClient.getInstance().searchApps(query);
    },
    placeholderData: keepPreviousData,
    retry: 0,
  });

  return {
    apps: data ?? [],
    loading: enabled ? isFetching || isLoading : false,
  };
}
