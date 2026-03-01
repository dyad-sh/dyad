import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ipc,
  type RenameMediaFileParams,
  type DeleteMediaFileParams,
  type MoveMediaFileParams,
} from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";

export function useAppMediaFiles() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.media.all,
    queryFn: () => ipc.media.listAllMedia(),
  });

  const renameMutation = useMutation({
    mutationFn: (params: RenameMediaFileParams) => {
      return ipc.media.renameMediaFile(params);
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      showSuccess(`Renamed image "${params.fileName}"`);
    },
    onError: (error) => {
      showError(error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (params: DeleteMediaFileParams) => {
      return ipc.media.deleteMediaFile(params);
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      showSuccess(`Deleted image "${params.fileName}"`);
    },
    onError: (error) => {
      showError(error);
    },
  });

  const moveMutation = useMutation({
    mutationFn: (params: MoveMediaFileParams) => {
      return ipc.media.moveMediaFile(params);
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      showSuccess(`Moved image "${params.fileName}"`);
    },
    onError: (error) => {
      showError(error);
    },
  });

  return {
    mediaApps: query.data?.apps ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
    renameMediaFile: renameMutation.mutateAsync,
    deleteMediaFile: deleteMutation.mutateAsync,
    moveMediaFile: moveMutation.mutateAsync,
    isMutatingMedia:
      renameMutation.isPending ||
      deleteMutation.isPending ||
      moveMutation.isPending,
  };
}
