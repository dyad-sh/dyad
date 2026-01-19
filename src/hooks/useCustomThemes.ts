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
    onSuccess: () => {
      // Invalidate all custom theme queries using prefix matching
      // This invalidates both global and all app-specific theme queries
      queryClient.invalidateQueries({
        queryKey: ["custom-themes"],
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
      const ipcClient = IpcClient.getInstance();
      return ipcClient.updateCustomTheme(params);
    },
    onSuccess: () => {
      // Invalidate all custom theme queries using prefix matching
      queryClient.invalidateQueries({
        queryKey: ["custom-themes"],
      });
    },
  });
}

export function useDeleteCustomTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      const ipcClient = IpcClient.getInstance();
      await ipcClient.deleteCustomTheme({ id });
    },
    onSuccess: () => {
      // Invalidate all custom theme queries using prefix matching
      queryClient.invalidateQueries({
        queryKey: ["custom-themes"],
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
