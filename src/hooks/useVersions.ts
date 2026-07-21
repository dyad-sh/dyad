import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, type Version } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export function useVersions(appId: number | null) {
  const queryClient = useQueryClient();

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
    queryFn: async () =>
      appId === null ? [] : ipc.version.listVersions({ appId }),
    enabled: appId !== null,
    placeholderData: [],
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
    versions: versions || [],
    loading,
    error,
    refreshVersions,
    setVersionFavorite: setVersionFavoriteMutation.mutateAsync,
    isSettingVersionFavorite: setVersionFavoriteMutation.isPending,
    setVersionNote: setVersionNoteMutation.mutateAsync,
    isSettingVersionNote: setVersionNoteMutation.isPending,
  };
}
