import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { themesData, type Theme } from "@/shared/themes";

export function useThemes() {
  const query = useQuery({
    queryKey: ["themes"],
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
