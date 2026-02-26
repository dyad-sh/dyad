import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type {
  CustomTemplate,
  CreateCustomTemplateParams,
  UpdateCustomTemplateParams,
} from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Hook to fetch all custom templates.
 */
export function useCustomTemplates() {
  const query = useQuery({
    queryKey: queryKeys.customTemplates.all,
    queryFn: async (): Promise<CustomTemplate[]> => {
      return ipc.template.getCustomTemplates();
    },
    meta: {
      showErrorToast: true,
    },
  });

  return {
    customTemplates: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateCustomTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: CreateCustomTemplateParams,
    ): Promise<CustomTemplate> => {
      return ipc.template.createCustomTemplate(params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.customTemplates.all,
      });
    },
  });
}

export function useUpdateCustomTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: UpdateCustomTemplateParams,
    ): Promise<CustomTemplate> => {
      return ipc.template.updateCustomTemplate(params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.customTemplates.all,
      });
    },
  });
}

export function useDeleteCustomTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await ipc.template.deleteCustomTemplate({ id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.customTemplates.all,
      });
    },
  });
}
