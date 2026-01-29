import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type {
  CustomTheme,
  CreateCustomThemeParams,
  UpdateCustomThemeParams,
  GenerateThemePromptParams,
  GenerateThemePromptResult,
  GenerateThemeFromUrlParams,
} from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Hook to fetch all custom themes.
 */
export function useCustomThemes() {
  const query = useQuery({
    queryKey: queryKeys.customThemes.all,
    queryFn: async (): Promise<CustomTheme[]> => {
      return ipc.template.getCustomThemes();
    },
    meta: {
      showErrorToast: true,
    },
  });

  return {
    customThemes: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateCustomTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: CreateCustomThemeParams,
    ): Promise<CustomTheme> => {
      return ipc.template.createCustomTheme(params);
    },
    onSuccess: () => {
      // Invalidate all custom theme queries using prefix matching
      queryClient.invalidateQueries({
        queryKey: queryKeys.customThemes.all,
      });
    },
  });
}

export function useUpdateCustomTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: UpdateCustomThemeParams,
    ): Promise<CustomTheme> => {
      return ipc.template.updateCustomTheme(params);
    },
    onSuccess: () => {
      // Invalidate all custom theme queries using prefix matching
      queryClient.invalidateQueries({
        queryKey: queryKeys.customThemes.all,
      });
    },
  });
}

export function useDeleteCustomTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await ipc.template.deleteCustomTheme({ id });
    },
    onSuccess: () => {
      // Invalidate all custom theme queries using prefix matching
      queryClient.invalidateQueries({
        queryKey: queryKeys.customThemes.all,
      });
    },
  });
}

export function useGenerateThemePrompt() {
  return useMutation({
    mutationFn: async (
      params: GenerateThemePromptParams,
    ): Promise<GenerateThemePromptResult> => {
      return ipc.template.generateThemePrompt(params);
    },
  });
}

export function useGenerateThemeFromUrl() {
  return useMutation({
    mutationFn: async (
      params: GenerateThemeFromUrlParams,
    ): Promise<GenerateThemePromptResult> => {
      return ipc.template.generateThemeFromUrl(params);
    },
  });
}
