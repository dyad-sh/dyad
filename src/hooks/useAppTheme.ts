import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";

export const APP_THEME_QUERY_KEY = (appId: number | undefined) => [
  "app-theme",
  appId,
];

export function useAppTheme(appId: number | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: APP_THEME_QUERY_KEY(appId),
    queryFn: async (): Promise<string | null> => {
      return IpcClient.getInstance().getAppTheme(appId!);
    },
    enabled: !!appId,
    staleTime: 30000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: APP_THEME_QUERY_KEY(appId) });
  };

  return {
    themeId: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    invalidate,
  };
}
