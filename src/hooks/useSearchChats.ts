import { ipc } from "@/ipc/types";
import type { ChatSearchResult } from "@/lib/schemas";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function useSearchChats(appId: number | null, query: string) {
  const enabled = Boolean(appId && query && query.trim().length > 0);

  const { data, isFetching, isLoading } = useQuery({
    queryKey: queryKeys.chats.search({ appId, query }),
    enabled,
    queryFn: async (): Promise<ChatSearchResult[]> => {
      // Non-null assertion safe due to enabled guard
      return ipc.chat.searchChats({ appId: appId as number, query });
    },
    placeholderData: keepPreviousData,
    retry: 0,
  });

  return {
    chats: data ?? [],
    loading: enabled ? isFetching || isLoading : false,
  };
}
