import { useEffect } from "react";
import { useAtom, useAtomValue } from "jotai";
import { versionsListAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";

import { chatMessagesAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { RevertVersionResponse, Version } from "@/ipc/ipc_types";
import { toast } from "sonner";

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

  const revertVersionMutation = useMutation<
    RevertVersionResponse,
    Error,
    { versionId: string }
  >({
    mutationFn: async ({ versionId }: { versionId: string }) => {
      const currentAppId = appId;
      if (currentAppId === null) {
        throw new Error("App ID is null");
      }
      const ipcClient = IpcClient.getInstance();
      return ipcClient.revertVersion({
        appId: currentAppId,
        previousVersionId: versionId,
      });
    },
    onSuccess: async (result) => {
      if ("successMessage" in result) {
        toast.success(result.successMessage);
      } else if ("warningMessage" in result) {
        toast.warning(result.warningMessage);
      }
      await queryClient.invalidateQueries({ queryKey: ["versions", appId] });
      await queryClient.invalidateQueries({
        queryKey: ["currentBranch", appId],
      });
      if (selectedChatId) {
        const chat = await IpcClient.getInstance().getChat(selectedChatId);
        setMessages(chat.messages);
      }
      await queryClient.invalidateQueries({
        queryKey: ["problems", appId],
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
