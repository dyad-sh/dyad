import { useEffect } from "react";
import { useAtom, useSetAtom } from "jotai";
import { versionsListAtom } from "@/atoms/appAtoms";
import { ipc, type RevertVersionResponse, type Version } from "@/ipc/types";

import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "sonner";

export function useVersions(appId: number | null) {
  const [, setVersionsAtom] = useAtom(versionsListAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const queryClient = useQueryClient();

  const {
    data: versions,
    isLoading: loading,
    error,
    refetch: refreshVersions,
  } = useQuery<Version[], Error>({
    queryKey: queryKeys.versions.list({ appId }),
    queryFn: async (): Promise<Version[]> => {
      if (appId === null) {
        return [];
      }
      return ipc.version.listVersions({ appId });
    },
    enabled: appId !== null,
    placeholderData: [],
    meta: { showErrorToast: true },
  });

  useEffect(() => {
    if (versions) {
      setVersionsAtom(versions);
    }
  }, [versions, setVersionsAtom]);

  const revertVersionMutation = useMutation<
    RevertVersionResponse,
    Error,
    {
      versionId: string;
      currentChatMessageId?: { chatId: number; messageId: number };
      // Optional: Explicitly specify which chat to refresh after revert.
      // If not provided, no chat messages will be refreshed.
      // This avoids race conditions when navigating to a new chat after revert.
      chatIdToRefresh?: number;
    }
  >({
    mutationFn: async ({
      versionId,
      currentChatMessageId,
    }: {
      versionId: string;
      currentChatMessageId?: { chatId: number; messageId: number };
      chatIdToRefresh?: number;
    }) => {
      const currentAppId = appId;
      if (currentAppId === null) {
        throw new Error("App ID is null");
      }
      return ipc.version.revertVersion({
        appId: currentAppId,
        previousVersionId: versionId,
        currentChatMessageId,
      });
    },
    onSuccess: async (result, variables) => {
      if ("successMessage" in result) {
        toast.success(result.successMessage);
      } else if ("warningMessage" in result) {
        toast.warning(result.warningMessage);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId }),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.branches.current({ appId }),
      });
      // Only refresh messages for the explicitly provided chat ID.
      // This avoids race conditions when the caller creates a new chat after revert.
      const chatIdToRefresh = variables.chatIdToRefresh;
      if (chatIdToRefresh) {
        const chat = await ipc.chat.getChat(chatIdToRefresh);
        setMessagesById((prev) => {
          const next = new Map(prev);
          next.set(chatIdToRefresh, chat.messages);
          return next;
        });
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.problems.byApp({ appId }),
      });
    },
    meta: { showErrorToast: true },
  });

  return {
    versions: versions || [],
    loading,
    error,
    refreshVersions,
    revertVersion: revertVersionMutation.mutateAsync,
    isRevertingVersion: revertVersionMutation.isPending,
  };
}
