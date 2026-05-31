import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import type { AppCollectionDto } from "@/ipc/types/app_collections";

export type AppCollection = AppCollectionDto;

export function useAppCollections() {
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.appCollections.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
  };

  const listQuery = useQuery({
    queryKey: queryKeys.appCollections.all,
    queryFn: async (): Promise<AppCollection[]> => {
      return ipc.appCollection.list();
    },
    meta: { showErrorToast: true },
  });

  const createMutation = useMutation({
    mutationFn: async (params: {
      name: string;
      appIds?: number[];
    }): Promise<AppCollection> => {
      return ipc.appCollection.create(params);
    },
    onSuccess: invalidateAll,
    meta: { showErrorToast: true },
  });

  const updateMutation = useMutation({
    mutationFn: async (params: {
      id: number;
      name: string;
      appIds?: number[];
    }): Promise<void> => {
      return ipc.appCollection.update(params);
    },
    onSuccess: invalidateAll,
    meta: { showErrorToast: true },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number): Promise<void> => {
      return ipc.appCollection.delete(id);
    },
    onSuccess: invalidateAll,
    meta: { showErrorToast: true },
  });

  const assignAppsMutation = useMutation({
    mutationFn: async (params: {
      collectionId: number | null;
      appIds: number[];
    }): Promise<void> => {
      return ipc.appCollection.assignApps(params);
    },
    onSuccess: invalidateAll,
    meta: { showErrorToast: true },
  });

  return {
    collections: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error,
    refetch: listQuery.refetch,
    createCollection: createMutation.mutateAsync,
    updateCollection: updateMutation.mutateAsync,
    deleteCollection: deleteMutation.mutateAsync,
    assignApps: assignAppsMutation.mutateAsync,
    isMutating:
      createMutation.isPending ||
      updateMutation.isPending ||
      deleteMutation.isPending ||
      assignAppsMutation.isPending,
  };
}
