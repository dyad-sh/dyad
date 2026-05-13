import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import type { CategoryDto } from "@/ipc/types/categories";

export type Category = CategoryDto;

export function useCategories() {
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.categories.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
  };

  const listQuery = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: async (): Promise<Category[]> => {
      return ipc.category.list();
    },
    meta: { showErrorToast: true },
  });

  const createMutation = useMutation({
    mutationFn: async (params: {
      name: string;
      appIds?: number[];
    }): Promise<Category> => {
      return ipc.category.create(params);
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
      return ipc.category.update(params);
    },
    onSuccess: invalidateAll,
    meta: { showErrorToast: true },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number): Promise<void> => {
      return ipc.category.delete(id);
    },
    onSuccess: invalidateAll,
    meta: { showErrorToast: true },
  });

  const assignAppsMutation = useMutation({
    mutationFn: async (params: {
      categoryId: number | null;
      appIds: number[];
    }): Promise<void> => {
      return ipc.category.assignApps(params);
    },
    onSuccess: invalidateAll,
    meta: { showErrorToast: true },
  });

  return {
    categories: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error,
    refetch: listQuery.refetch,
    createCategory: createMutation.mutateAsync,
    updateCategory: updateMutation.mutateAsync,
    deleteCategory: deleteMutation.mutateAsync,
    assignApps: assignAppsMutation.mutateAsync,
    isMutating:
      createMutation.isPending ||
      updateMutation.isPending ||
      deleteMutation.isPending ||
      assignAppsMutation.isPending,
  };
}
