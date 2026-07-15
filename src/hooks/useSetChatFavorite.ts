import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { ChatSummary } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";

type SetChatFavoriteVariables = {
  chatId: number;
  appId: number;
  isFavorite: boolean;
};

type ChatListSnapshot = [readonly unknown[], ChatSummary[] | undefined];

export function useSetChatFavorite() {
  const queryClient = useQueryClient();

  return useMutation<
    { isFavorite: boolean },
    Error,
    SetChatFavoriteVariables,
    { snapshots: ChatListSnapshot[] }
  >({
    mutationFn: ({ chatId, isFavorite }) =>
      ipc.chat.setChatFavorite({ chatId, isFavorite }),
    onMutate: async ({ chatId, appId, isFavorite }) => {
      const queryKeysToUpdate = [
        queryKeys.chats.list({ appId }),
        queryKeys.chats.list({ appId: null }),
      ] as const;

      await Promise.all(
        queryKeysToUpdate.map((queryKey) =>
          queryClient.cancelQueries({ queryKey, exact: true }),
        ),
      );

      const snapshots = queryKeysToUpdate.map(
        (queryKey) =>
          [
            queryKey,
            queryClient.getQueryData<ChatSummary[]>(queryKey),
          ] satisfies ChatListSnapshot,
      );

      for (const queryKey of queryKeysToUpdate) {
        queryClient.setQueryData<ChatSummary[]>(queryKey, (current) =>
          current?.map((chat) =>
            chat.id === chatId ? { ...chat, isFavorite } : chat,
          ),
        );
      }

      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      for (const [queryKey, snapshot] of context?.snapshots ?? []) {
        queryClient.setQueryData(queryKey, snapshot);
      }
    },
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.chats.list({ appId: variables.appId }),
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.chats.list({ appId: null }),
          exact: true,
        }),
      ]);
    },
  });
}
