import { useCallback, useEffect } from "react";
import { useAtom, useAtomValue } from "jotai";
import { versionsListAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";
import { chatMessagesAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Version } from "@/ipc/ipc_types";

export function useVersions(appId: number | null) {
  const [, setVersionsAtom] = useAtom(versionsListAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const [, setMessages] = useAtom(chatMessagesAtom);
  const queryClient = useQueryClient();

  const {
    data: versions,
    isLoading: loading,
    error,
    refetch: refreshVersions,
  } = useQuery<Version[], Error>({
    queryKey: ["versions", appId],
    queryFn: async (): Promise<Version[]> => {
      if (appId === null) {
        return [];
      }
      const ipcClient = IpcClient.getInstance();
      return ipcClient.listVersions({ appId });
    },
    enabled: appId !== null,
    initialData: [],
    meta: { showErrorToast: true },
  });

  useEffect(() => {
    if (versions) {
      setVersionsAtom(versions);
    }
  }, [versions, setVersionsAtom]);

  const revertVersionMutation = useMutation<void, Error, { versionId: string }>(
    {
      mutationFn: async ({ versionId }: { versionId: string }) => {
        if (appId === null) {
          throw new Error("App ID is null");
        }
        const ipcClient = IpcClient.getInstance();
        await ipcClient.revertVersion({ appId, previousVersionId: versionId });
      },
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: ["versions", appId] });
        if (selectedChatId) {
          const chat = await IpcClient.getInstance().getChat(selectedChatId);
          setMessages(chat.messages);
        }
      },
      onError: (e: Error) => {
        showError(e);
      },
    },
  );

  const revertVersion = useCallback(
    async ({ versionId }: { versionId: string }) => {
      if (appId === null) {
        return;
      }
      await revertVersionMutation.mutateAsync({ versionId });
    },
    [appId, revertVersionMutation],
  );

  return {
    versions: versions || [],
    loading,
    error,
    refreshVersions,
    revertVersion,
  };
}
