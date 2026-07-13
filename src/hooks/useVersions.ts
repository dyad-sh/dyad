import { useAtomValue, useSetAtom } from "jotai";
import { useMemo } from "react";
import { ipc, type RevertVersionResponse, type Version } from "@/ipc/types";
import { DEFAULT_VERSION_PAGE_SIZE } from "@/ipc/types/version";

import { chatMessagesByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "sonner";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { useRunApp } from "./useRunApp";
import { useSettings } from "./useSettings";

const MAX_LOADED_VERSION_PAGES = 20;

export function useVersions(appId: number | null) {
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const queryClient = useQueryClient();
  const { restartApp } = useRunApp();
  const { settings } = useSettings();
  type VersionPage = Awaited<ReturnType<typeof ipc.version.listVersions>>;
  type VersionCursor = NonNullable<VersionPage["nextCursor"]>;

  const updateVersionMetadataCache = (
    oid: string,
    updates: Partial<Pick<Version, "isFavorite" | "note">>,
    targetAppId = appId,
  ) => {
    queryClient.setQueryData<InfiniteData<VersionPage>>(
      queryKeys.versions.list({ appId: targetAppId }),
      (oldData) =>
        oldData
          ? {
              ...oldData,
              pages: oldData.pages.map((page) => ({
                ...page,
                versions: page.versions.map((version) =>
                  version.oid === oid ? { ...version, ...updates } : version,
                ),
              })),
            }
          : oldData,
    );
  };

  const {
    data,
    isLoading: loading,
    error,
    refetch: refreshVersions,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<
    VersionPage,
    Error,
    InfiniteData<VersionPage>,
    ReturnType<typeof queryKeys.versions.list>,
    VersionCursor | undefined
  >({
    queryKey: queryKeys.versions.list({ appId }),
    queryFn: async ({ pageParam }): Promise<VersionPage> => {
      if (appId === null) {
        return { versions: [], nextCursor: null, totalCount: 0 };
      }
      return ipc.version.listVersions({
        appId,
        cursor: pageParam,
        limit: DEFAULT_VERSION_PAGE_SIZE,
      });
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage, allPages) =>
      allPages.length >= MAX_LOADED_VERSION_PAGES
        ? undefined
        : (lastPage.nextCursor ?? undefined),
    enabled: appId !== null,
    meta: { showErrorToast: true },
  });

  const loadedVersions = useMemo(
    () => data?.pages.flatMap((page) => page.versions) ?? [],
    [data?.pages],
  );
  const firstPageTotal = data?.pages[0]?.totalCount;
  const totalVersionCount = firstPageTotal ?? loadedVersions.length;
  const versionHistoryLimitReached =
    !hasNextPage && (data?.pages.at(-1)?.nextCursor ?? null) !== null;

  const refreshVersionList = async () => {
    const result = await refreshVersions();
    return {
      ...result,
      data: result.data?.pages.flatMap((page) => page.versions),
    };
  };

  const revertVersionMutation = useMutation<
    RevertVersionResponse,
    Error,
    {
      versionId: string;
      currentChatMessageId?: { chatId: number; messageId: number };
      targetBranchName?: string;
    }
  >({
    mutationFn: async ({
      versionId,
      currentChatMessageId,
      targetBranchName,
    }: {
      versionId: string;
      currentChatMessageId?: { chatId: number; messageId: number };
      targetBranchName?: string;
    }) => {
      const currentAppId = appId;
      if (currentAppId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.revertVersion({
        appId: currentAppId,
        previousVersionId: versionId,
        currentChatMessageId,
        targetBranchName,
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

  return {
    versions: loadedVersions,
    totalVersionCount,
    hasMoreVersions: hasNextPage,
    versionHistoryLimitReached,
    loadMoreVersions: fetchNextPage,
    isLoadingMoreVersions: isFetchingNextPage,
    loading,
    error,
    refreshVersions: refreshVersionList,
    revertVersion: revertVersionMutation.mutateAsync,
    isRevertingVersion: revertVersionMutation.isPending,
    setVersionFavorite: setVersionFavoriteMutation.mutateAsync,
    isSettingVersionFavorite: setVersionFavoriteMutation.isPending,
    setVersionNote: setVersionNoteMutation.mutateAsync,
    isSettingVersionNote: setVersionNoteMutation.isPending,
  };
}
