import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, type Chat } from "@/ipc/types";
import type { ChatSummary } from "@/lib/schemas";
import {
  getEffectiveDefaultChatMode,
  type ChatMode,
  type UserSettings,
} from "@/lib/schemas";
import {
  getUnavailableChatModeReason,
  type ChatModeFallbackReason,
} from "@/lib/chatMode";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "./useSettings";
import { useFreeAgentQuota } from "./useFreeAgentQuota";

type ChatModeMutationContext = {
  previousChat?: Chat;
  previousLists: [readonly unknown[], ChatSummary[] | undefined][];
};

const chatListQueryFilter = {
  predicate: (query: { queryKey: readonly unknown[] }) =>
    query.queryKey[0] === "chats" && query.queryKey.length === 2,
};

export function useChatMode(chatId: number | null | undefined) {
  const queryClient = useQueryClient();
  const { settings, envVars, updateSettings } = useSettings();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();
  const activeChatId = chatId ?? null;

  const chatQuery = useQuery({
    queryKey: queryKeys.chats.detail({ chatId: activeChatId }),
    queryFn: () => ipc.chat.getChat(activeChatId!),
    enabled: activeChatId !== null,
  });

  const freeAgentQuotaAvailable = isQuotaLoading ? undefined : !isQuotaExceeded;
  const effectiveDefaultMode = settings
    ? getEffectiveDefaultChatMode(settings, envVars, freeAgentQuotaAvailable)
    : "build";

  const storedChatMode = chatQuery.data?.chatMode ?? null;
  const selectedMode = activeChatId
    ? (storedChatMode ?? effectiveDefaultMode)
    : (settings?.selectedChatMode ?? "build");

  const fallbackReason = useMemo<ChatModeFallbackReason | undefined>(() => {
    if (!settings || !activeChatId || !storedChatMode) {
      return undefined;
    }

    return getUnavailableChatModeReason({
      mode: storedChatMode,
      settings,
      freeAgentQuotaAvailable,
    });
  }, [activeChatId, freeAgentQuotaAvailable, settings, storedChatMode]);

  const effectiveMode =
    activeChatId && fallbackReason ? effectiveDefaultMode : selectedMode;

  const updateChatModeMutation = useMutation<
    void,
    Error,
    ChatMode | null,
    ChatModeMutationContext
  >({
    mutationFn: async (chatMode) => {
      if (activeChatId === null) {
        return;
      }
      await ipc.chat.updateChat({
        chatId: activeChatId,
        chatMode,
      });
    },
    onMutate: async (chatMode) => {
      if (activeChatId === null) {
        return { previousLists: [] };
      }

      await queryClient.cancelQueries({
        queryKey: queryKeys.chats.detail({ chatId: activeChatId }),
      });
      await queryClient.cancelQueries(chatListQueryFilter);

      const previousChat = queryClient.getQueryData<Chat>(
        queryKeys.chats.detail({ chatId: activeChatId }),
      );
      const previousLists =
        queryClient.getQueriesData<ChatSummary[]>(chatListQueryFilter);

      queryClient.setQueryData<Chat>(
        queryKeys.chats.detail({ chatId: activeChatId }),
        (old) => (old ? { ...old, chatMode } : old),
      );
      queryClient.setQueriesData<ChatSummary[]>(chatListQueryFilter, (old) =>
        old?.map((chat) =>
          chat.id === activeChatId ? { ...chat, chatMode } : chat,
        ),
      );

      return { previousChat, previousLists };
    },
    onError: (_error, _chatMode, context) => {
      if (activeChatId !== null && context?.previousChat) {
        queryClient.setQueryData(
          queryKeys.chats.detail({ chatId: activeChatId }),
          context.previousChat,
        );
      }
      for (const [queryKey, data] of context?.previousLists ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
    },
    onSettled: () => {
      if (activeChatId !== null) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.chats.detail({ chatId: activeChatId }),
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      }
    },
    meta: { showErrorToast: true },
  });

  const setChatMode = useCallback(
    async (mode: ChatMode | null) => {
      if (activeChatId !== null) {
        await updateChatModeMutation.mutateAsync(mode);
        return;
      }

      if (mode !== null) {
        await updateSettings({ selectedChatMode: mode });
      }
    },
    [activeChatId, updateChatModeMutation, updateSettings],
  );

  return {
    chat: chatQuery.data ?? null,
    isLoading: chatQuery.isLoading,
    storedChatMode,
    selectedMode,
    effectiveMode,
    effectiveDefaultMode,
    fallbackReason,
    setChatMode,
    isUpdating: updateChatModeMutation.isPending,
    settings: settings as UserSettings | null,
  };
}
