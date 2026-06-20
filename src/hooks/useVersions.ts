import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import {
  ipc,
  type RevertVersionResponse,
  type Version,
  type UncommittedChangesStrategy,
} from "@/ipc/types";

import { chatMessagesByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import {
  uncommittedChangesGateAtom,
  type UncommittedChangesResolution,
} from "@/atoms/uncommittedChangesGateAtom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "sonner";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { useRunApp } from "./useRunApp";
import { useSettings } from "./useSettings";

type RevertVersionArgs = {
  versionId: string;
  currentChatMessageId?: { chatId: number; messageId: number };
};

type RevertVersionMutationVariables = RevertVersionArgs & {
  uncommittedChangesStrategy?: UncommittedChangesStrategy;
  commitMessage?: string;
};

export function useVersions(appId: number | null) {
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const queryClient = useQueryClient();
  const { restartApp } = useRunApp();
  const { settings } = useSettings();
  const setUncommittedChangesGate = useSetAtom(uncommittedChangesGateAtom);

  const updateVersionMetadataCache = (
    oid: string,
    updates: Partial<Pick<Version, "isFavorite" | "note">>,
    targetAppId = appId,
  ) => {
    queryClient.setQueryData<Version[]>(
      queryKeys.versions.list({ appId: targetAppId }),
      (oldVersions) =>
        oldVersions?.map((version) =>
          version.oid === oid ? { ...version, ...updates } : version,
        ),
    );
  };

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
    RevertVersionMutationVariables
  >({
    mutationFn: async ({
      versionId,
      currentChatMessageId,
      uncommittedChangesStrategy,
      commitMessage,
    }: RevertVersionMutationVariables) => {
      const currentAppId = appId;
      if (currentAppId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.revertVersion({
        appId: currentAppId,
        previousVersionId: versionId,
        currentChatMessageId,
        uncommittedChangesStrategy,
        commitMessage,
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
    { appId?: number | null; versionId: string; isFavorite: boolean }
  >({
    mutationFn: async ({ appId: mutationAppId, versionId, isFavorite }) => {
      const targetAppId = mutationAppId === undefined ? appId : mutationAppId;
      if (targetAppId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.setVersionFavorite({
        appId: targetAppId,
        versionId,
        isFavorite,
      });
    },
    onSuccess: (result, variables) => {
      updateVersionMetadataCache(
        result.oid,
        { isFavorite: result.isFavorite },
        variables.appId === undefined ? appId : variables.appId,
      );
    },
    meta: { showErrorToast: true },
  });

  const setVersionNoteMutation = useMutation<
    { oid: string; isFavorite: boolean; note: string | null },
    Error,
    { appId?: number | null; versionId: string; note: string | null }
  >({
    mutationFn: async ({ appId: mutationAppId, versionId, note }) => {
      const targetAppId = mutationAppId === undefined ? appId : mutationAppId;
      if (targetAppId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.setVersionNote({
        appId: targetAppId,
        versionId,
        note,
      });
    },
    onSuccess: (result, variables) => {
      updateVersionMetadataCache(
        result.oid,
        { note: result.note },
        variables.appId === undefined ? appId : variables.appId,
      );
    },
    meta: { showErrorToast: true },
  });

  // Gate the revert on a clean worktree. If there are uncommitted changes, open
  // the app-wide dialog (see UncommittedChangesGateDialog) to get the user's
  // choice, which the revert handler applies on `main` before reverting. Returns
  // null if the user cancels.
  const revertVersion = useCallback(
    async (vars: RevertVersionArgs): Promise<RevertVersionResponse | null> => {
      if (appId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      const uncommittedFiles = await queryClient.fetchQuery({
        queryKey: queryKeys.uncommittedFiles.byApp({ appId }),
        queryFn: () => ipc.git.getUncommittedFiles({ appId }),
        // Always read the current worktree state — the cached value (populated by
        // the banner's poll under the global 60s staleTime) can be stale right
        // after an edit, which would skip the gate.
        staleTime: 0,
      });
      let resolution: UncommittedChangesResolution | null = null;
      if (uncommittedFiles.length > 0) {
        resolution = await new Promise<UncommittedChangesResolution | null>(
          (resolve) => {
            setUncommittedChangesGate({
              open: true,
              appId,
              onResolve: (r) => resolve(r),
              onCancel: () => resolve(null),
            });
          },
        );
        setUncommittedChangesGate({
          open: false,
          appId: null,
          onResolve: null,
          onCancel: null,
        });
        if (!resolution) {
          return null;
        }
      }
      return revertVersionMutation.mutateAsync({
        ...vars,
        uncommittedChangesStrategy: resolution?.action,
        commitMessage:
          resolution?.action === "commit"
            ? resolution.commitMessage
            : undefined,
      });
    },
    [
      appId,
      queryClient,
      setUncommittedChangesGate,
      revertVersionMutation.mutateAsync,
    ],
  );

  return {
    versions: versions || [],
    loading,
    error,
    refreshVersions,
    revertVersion,
    isRevertingVersion: revertVersionMutation.isPending,
    setVersionFavorite: setVersionFavoriteMutation.mutateAsync,
    isSettingVersionFavorite: setVersionFavoriteMutation.isPending,
    setVersionNote: setVersionNoteMutation.mutateAsync,
    isSettingVersionNote: setVersionNoteMutation.isPending,
  };
}
