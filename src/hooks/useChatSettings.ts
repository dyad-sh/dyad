import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { ipc } from "@/ipc/types";
import type { ChatMode, LargeLanguageModel } from "@/lib/schemas";
import { useSettings } from "./useSettings";

const pendingChatSettingsUpdates = new Map<number, Promise<unknown>>();

/**
 * Hook to get and update per-chat settings (mode and model).
 * Falls back to global user settings if no per-chat settings are set.
 */
export function useChatSettings(chatId: number | null) {
  const queryClient = useQueryClient();
  const { settings } = useSettings();

  const { data: chatSettings, isLoading } = useQuery({
    queryKey: queryKeys.chats.settings({ chatId }),
    queryFn: async () => {
      if (chatId === null) {
        return null;
      }
      return ipc.chat.getChatSettings(chatId);
    },
    enabled: chatId !== null,
  });

  const updateChatSettingsMutation = useMutation({
    mutationFn: async (params: {
      chatMode?: ChatMode;
      selectedModel?: LargeLanguageModel;
    }) => {
      if (chatId === null) {
        throw new Error("Cannot update settings without a chat ID");
      }
      return ipc.chat.updateChatSettings({
        chatId,
        ...params,
      });
    },
    onMutate: async (params) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.chats.settings({ chatId }),
      });

      const previousSettings = queryClient.getQueryData<{
        chatMode: ChatMode | null;
        selectedModel: LargeLanguageModel | null;
      }>(queryKeys.chats.settings({ chatId }));

      queryClient.setQueryData(queryKeys.chats.settings({ chatId }), {
        chatMode: params.chatMode ?? previousSettings?.chatMode ?? null,
        selectedModel:
          params.selectedModel ?? previousSettings?.selectedModel ?? null,
      });

      return { previousSettings };
    },
    onError: (_error, _params, context) => {
      if (context?.previousSettings !== undefined) {
        queryClient.setQueryData(
          queryKeys.chats.settings({ chatId }),
          context.previousSettings,
        );
      }
    },
    onSuccess: () => {
      // Invalidate the chat settings query to refetch
      queryClient.invalidateQueries({
        queryKey: queryKeys.chats.settings({ chatId }),
      });
      // Also invalidate token count since model change affects context window
      queryClient.invalidateQueries({
        queryKey: queryKeys.tokenCount.all,
      });
    },
  });

  const startChatSettingsUpdate = (params: {
    chatMode?: ChatMode;
    selectedModel?: LargeLanguageModel;
  }) => {
    if (chatId === null) {
      return Promise.reject(
        new Error("Cannot update settings without a chat ID"),
      );
    }

    const updatePromise = updateChatSettingsMutation.mutateAsync(params);
    pendingChatSettingsUpdates.set(chatId, updatePromise);
    void updatePromise.finally(() => {
      if (pendingChatSettingsUpdates.get(chatId) === updatePromise) {
        pendingChatSettingsUpdates.delete(chatId);
      }
    });

    return updatePromise;
  };

  // Effective settings: per-chat if set, otherwise fall back to global
  const effectiveChatMode: ChatMode =
    chatSettings?.chatMode ?? settings?.selectedChatMode ?? "build";
  const effectiveModel: LargeLanguageModel = chatSettings?.selectedModel ??
    settings?.selectedModel ?? {
      name: "auto",
      provider: "auto",
    };

  return {
    // Raw per-chat settings (null means not set)
    chatSettings,
    isLoading,

    // Effective settings (with fallback to global)
    effectiveChatMode,
    effectiveModel,

    // Treat both null and undefined as "no per-chat override".
    isUsingGlobalSettings: {
      chatMode: chatSettings?.chatMode == null,
      model: chatSettings?.selectedModel == null,
    },

    // Update functions
    updateChatMode: (chatMode: ChatMode) => {
      return startChatSettingsUpdate({ chatMode });
    },
    updateSelectedModel: (selectedModel: LargeLanguageModel) => {
      return startChatSettingsUpdate({ selectedModel });
    },
    waitForPendingUpdate:
      chatId === null
        ? async () => {}
        : async () => {
            await (pendingChatSettingsUpdates.get(chatId) ?? Promise.resolve());
          },
    isUpdating: updateChatSettingsMutation.isPending,
  };
}
