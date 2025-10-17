import { useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { versionsListAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";

import { chatMessagesByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { RevertVersionResponse, Version } from "@/ipc/ipc_types";
import { toast } from "sonner";

/**
 * A hook for managing app versions.
 * @param {number | null} appId - The ID of the app.
 * @returns {object} An object with the list of versions, loading state, error, and functions to manage versions.
 * @property {Version[]} versions - The list of versions.
 * @property {boolean} loading - Whether the versions are being loaded.
 * @property {Error | null} error - The error object if the query fails.
 * @property {() => void} refreshVersions - A function to refetch the versions.
 * @property {(params: { versionId: string; }) => Promise<RevertVersionResponse>} revertVersion - A function to revert to a specific version.
 * @property {boolean} isRevertingVersion - Whether a version is being reverted.
 */
export function useVersions(appId: number | null) {
  const [, setVersionsAtom] = useAtom(versionsListAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
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
        setMessagesById((prev) => {
          const next = new Map(prev);
          next.set(selectedChatId, chat.messages);
          return next;
        });
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
