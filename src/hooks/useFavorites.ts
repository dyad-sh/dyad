import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { Favorite } from "@/ipc/ipc_types";
import { showError } from "@/lib/toast";

export function useFavorites(appId: number | null) {
  const queryClient = useQueryClient();

  // Query for listing favorites
  const {
    data: favorites = [],
    isLoading,
    error,
    refetch: refreshFavorites,
  } = useQuery({
    queryKey: ["favorites", appId],
    queryFn: async () => {
      if (!appId) return [];
      const ipcClient = IpcClient.getInstance();
      return ipcClient.listFavorites({ appId });
    },
    enabled: appId !== null,
    meta: { showErrorToast: true },
  });

  // Mutation for creating a favorite
  const createFavoriteMutation = useMutation({
    mutationFn: async (params: {
      commitHash: string;
      neonBranchId?: string;
    }) => {
      if (!appId) throw new Error("App ID is required");
      const ipcClient = IpcClient.getInstance();
      return ipcClient.createFavorite({
        appId,
        commitHash: params.commitHash,
        neonBranchId: params.neonBranchId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorites", appId] });
    },
    onError: (error) => {
      showError(error);
    },
  });

  // Mutation for deleting a favorite
  const deleteFavoriteMutation = useMutation({
    mutationFn: async (favoriteId: number) => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.deleteFavorite({ favoriteId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorites", appId] });
    },
    onError: (error) => {
      showError(error);
    },
  });

  // Helper function to check if a commit hash is favorited
  const isFavorited = (commitHash: string): boolean => {
    return favorites.some((favorite) => favorite.commitHash === commitHash);
  };

  // Helper function to get favorite by commit hash
  const getFavoriteByCommitHash = (
    commitHash: string,
  ): Favorite | undefined => {
    return favorites.find((favorite) => favorite.commitHash === commitHash);
  };

  // Helper function to create a favorite
  const createFavorite = async (commitHash: string) => {
    return createFavoriteMutation.mutateAsync({ commitHash });
  };

  // Helper function to delete a favorite
  const deleteFavorite = async (commitHash: string) => {
    const favorite = getFavoriteByCommitHash(commitHash);
    if (favorite) {
      return deleteFavoriteMutation.mutateAsync(favorite.id);
    }
  };

  // Helper function to toggle favorite status
  const toggleFavorite = async (commitHash: string, neonBranchId?: string) => {
    if (isFavorited(commitHash)) {
      await deleteFavorite(commitHash);
    } else {
      await createFavorite(commitHash);
    }
  };

  return {
    favorites,
    isLoading,
    error,
    refreshFavorites,
    isFavorited,
    getFavoriteByCommitHash,
    createFavorite,
    deleteFavorite,
    toggleFavorite,
    isCreatingFavorite: createFavoriteMutation.isPending,
    isDeletingFavorite: deleteFavoriteMutation.isPending,
    isUpdatingFavorite:
      createFavoriteMutation.isPending || deleteFavoriteMutation.isPending,
  };
}
