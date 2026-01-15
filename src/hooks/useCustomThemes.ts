import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type {
  CustomTheme,
  CreateCustomThemeParams,
  UpdateCustomThemeParams,
  GenerateThemePromptParams,
  GenerateThemePromptResult,
} from "@/ipc/ipc_types";

// Query key that handles both app-specific and global themes
export const CUSTOM_THEMES_QUERY_KEY = (appId?: number) => [
  "custom-themes",
  appId ?? "global",
];

/**
 * Hook to fetch custom themes.
 * - If appId is provided: returns global themes + app-specific themes
 * - If appId is undefined: returns only global themes
 */
export function useCustomThemes(appId?: number) {
  const query = useQuery({
    queryKey: CUSTOM_THEMES_QUERY_KEY(appId),
    queryFn: async (): Promise<CustomTheme[]> => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getCustomThemes({ appId });
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
      const ipcClient = IpcClient.getInstance();
      return ipcClient.createCustomTheme(params);
    },
    onSuccess: (_, variables) => {
      // Invalidate both the specific app query and global query
      queryClient.invalidateQueries({
        queryKey: CUSTOM_THEMES_QUERY_KEY(variables.appId),
      });
      // Also invalidate global themes query if creating a global theme
      if (!variables.appId) {
        queryClient.invalidateQueries({
          queryKey: CUSTOM_THEMES_QUERY_KEY(undefined),
        });
      }
    },
  });
}

export function useUpdateCustomTheme(appId?: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: UpdateCustomThemeParams,
    ): Promise<CustomTheme> => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.updateCustomTheme(params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: CUSTOM_THEMES_QUERY_KEY(appId),
      });
    },
  });
}

export function useDeleteCustomTheme(appId?: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      const ipcClient = IpcClient.getInstance();
      await ipcClient.deleteCustomTheme({ id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: CUSTOM_THEMES_QUERY_KEY(appId),
      });
    },
  });
}

export function useGenerateThemePrompt() {
  return useMutation({
    mutationFn: async (
      params: GenerateThemePromptParams,
    ): Promise<GenerateThemePromptResult> => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.generateThemePrompt(params);
    },
  });
}
