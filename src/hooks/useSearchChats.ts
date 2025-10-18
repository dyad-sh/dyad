import { IpcClient } from "@/ipc/ipc_client";
import type { ChatSearchResult } from "@/lib/schemas";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

/**
 * A hook for searching chats within an app.
 * @param {number | null} appId - The ID of the app.
 * @param {string} query - The search query.
 * @returns {object} An object with the list of chats and the loading state.
 * @property {ChatSearchResult[]} chats - The list of chats that match the query.
 * @property {boolean} loading - Whether the search is in progress.
 */
export function useSearchChats(appId: number | null, query: string) {
  const enabled = Boolean(appId && query && query.trim().length > 0);

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ["search-chats", appId, query],
    enabled,
    queryFn: async (): Promise<ChatSearchResult[]> => {
      // Non-null assertion safe due to enabled guard
      return IpcClient.getInstance().searchChats(appId as number, query);
    },
    placeholderData: keepPreviousData,
    retry: 0,
  });

  return {
    chats: data ?? [],
    loading: enabled ? isFetching || isLoading : false,
  };
}
