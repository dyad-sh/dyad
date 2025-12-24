import { IpcClient } from "@/ipc/ipc_client";
import type { ChatSummary } from "@/lib/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const CHATS_QUERY_KEY = "chats";

export function useChats(appId: number | null) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery<ChatSummary[]>({
    queryKey: [CHATS_QUERY_KEY, appId],
    queryFn: async () => {
      return IpcClient.getInstance().getChats(appId ?? undefined);
    },
  });

  const invalidateChats = () => {
    queryClient.invalidateQueries({ queryKey: [CHATS_QUERY_KEY, appId] });
  };

  return {
    chats: data ?? [],
    loading: isLoading,
    refreshChats: refetch,
    invalidateChats,
  };
}
