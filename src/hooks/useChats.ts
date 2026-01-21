import { ipc } from "@/ipc/types";
import type { ChatSummary } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export function useChats(appId: number | null) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ChatSummary[]>({
    queryKey: queryKeys.chats.list({ appId }),
    queryFn: async () => {
      return ipc.chat.getChats(appId ?? undefined);
    },
  });

  const invalidateChats = () => {
    // Invalidate all chat queries (any appId) since mutations affect both
    // app-specific lists and the global list (appId=null)
    queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
  };

  return {
    chats: data ?? [],
    loading: isLoading,
    invalidateChats,
  };
}
