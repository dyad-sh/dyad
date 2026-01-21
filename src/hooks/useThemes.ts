import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { themesData, type Theme } from "@/shared/themes";
import { queryKeys } from "@/lib/queryKeys";

export function useThemes() {
  const query = useQuery({
    queryKey: queryKeys.themes.all,
    queryFn: async (): Promise<Theme[]> => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getThemes();
    },
    placeholderData: themesData,
    meta: {
      showErrorToast: true,
    },
  });

  return {
    themes: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
