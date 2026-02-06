import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { ListedApp } from "@/ipc/types/app";
import { showError, showSuccess } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";

export function useAddAppToFavorite() {
  const queryClient = useQueryClient();

  const mutation = useMutation<boolean, Error, number>({
    mutationFn: async (appId: number): Promise<boolean> => {
      const result = await ipc.app.addToFavorite({ appId });
      return result.isFavorite;
    },
    onSuccess: (newIsFavorite, appId) => {
      queryClient.setQueryData<ListedApp[]>(queryKeys.apps.all, (oldApps) =>
        oldApps?.map((app) =>
          app.id === appId ? { ...app, isFavorite: newIsFavorite } : app,
        ),
      );
      showSuccess("App favorite status updated");
    },
    onError: (error) => {
      showError(error.message || "Failed to update favorite status");
    },
  });

  return {
    toggleFavorite: mutation.mutate,
    toggleFavoriteAsync: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: mutation.error,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
  };
}
