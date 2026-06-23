import { useAtomValue, useSetAtom } from "jotai";
import { ipc, type RevertVersionResponse, type Version } from "@/ipc/types";

import { chatMessagesByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "sonner";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { useRunApp } from "./useRunApp";
import { useSettings } from "./useSettings";

export function useVersions(appId: number | null) {
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const queryClient = useQueryClient();
  const { restartApp } = useRunApp();
  const { settings } = useSettings();

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

  const revertVersionMutation = useMutation<
    RevertVersionResponse,
    Error,
    {
      versionId: string;
      currentChatMessageId?: { chatId: number; messageId: number };
    }
  >({
    mutationFn: async ({
      versionId,
      currentChatMessageId,
    }: {
      versionId: string;
      currentChatMessageId?: { chatId: number; messageId: number };
    }) => {
      const currentAppId = appId;
      if (currentAppId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.revertVersion({
        appId: currentAppId,
        previousVersionId: versionId,
        currentChatMessageId,
      });
    },
    onSuccess: async (result) => {
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
      if (selectedChatId) {
        const chat = await ipc.chat.getChat(selectedChatId);
        setMessagesById((prev) => {
          const next = new Map(prev);
          next.set(selectedChatId, chat.messages);
          return next;
        });
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.problems.byApp({ appId }),
      });
      if (settings?.runtimeMode2 === "cloud") {
        await restartApp();
      }
    },
    meta: { showErrorToast: true },
  });

  const setVersionFavoriteMutation = useMutation<
    { oid: string; isFavorite: boolean; note: string | null },
    Error,
    { versionId: string; isFavorite: boolean },
    { previousVersions?: Version[] }
  >({
    mutationFn: async ({ versionId, isFavorite }) => {
      if (appId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.setVersionFavorite({
        appId,
        versionId,
        isFavorite,
      });
    },
    onMutate: async ({ versionId, isFavorite }) => {
      const queryKey = queryKeys.versions.list({ appId });
      await queryClient.cancelQueries({ queryKey });
      const previousVersions = queryClient.getQueryData<Version[]>(queryKey);
      queryClient.setQueryData<Version[]>(queryKey, (oldVersions) =>
        oldVersions?.map((version) =>
          version.oid === versionId ? { ...version, isFavorite } : version,
        ),
      );
      return { previousVersions };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousVersions) {
        queryClient.setQueryData(
          queryKeys.versions.list({ appId }),
          context.previousVersions,
        );
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData<Version[]>(
        queryKeys.versions.list({ appId }),
        (oldVersions) =>
          oldVersions?.map((version) =>
            version.oid === result.oid
              ? {
                  ...version,
                  isFavorite: result.isFavorite,
                  note: result.note,
                }
              : version,
          ),
      );
    },
    meta: { showErrorToast: true },
  });

  const setVersionNoteMutation = useMutation<
    { oid: string; isFavorite: boolean; note: string | null },
    Error,
    { versionId: string; note: string | null },
    { previousVersions?: Version[] }
  >({
    mutationFn: async ({ versionId, note }) => {
      if (appId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.setVersionNote({
        appId,
        versionId,
        note,
      });
    },
    onMutate: async ({ versionId, note }) => {
      const queryKey = queryKeys.versions.list({ appId });
      await queryClient.cancelQueries({ queryKey });
      const previousVersions = queryClient.getQueryData<Version[]>(queryKey);
      const normalizedNote = note?.trim() || null;
      queryClient.setQueryData<Version[]>(queryKey, (oldVersions) =>
        oldVersions?.map((version) =>
          version.oid === versionId
            ? { ...version, note: normalizedNote }
            : version,
        ),
      );
      return { previousVersions };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousVersions) {
        queryClient.setQueryData(
          queryKeys.versions.list({ appId }),
          context.previousVersions,
        );
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData<Version[]>(
        queryKeys.versions.list({ appId }),
        (oldVersions) =>
          oldVersions?.map((version) =>
            version.oid === result.oid
              ? {
                  ...version,
                  isFavorite: result.isFavorite,
                  note: result.note,
                }
              : version,
          ),
      );
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
    setVersionFavorite: setVersionFavoriteMutation.mutateAsync,
    isSettingVersionFavorite: setVersionFavoriteMutation.isPending,
    setVersionNote: setVersionNoteMutation.mutateAsync,
    isSettingVersionNote: setVersionNoteMutation.isPending,
  };
}
