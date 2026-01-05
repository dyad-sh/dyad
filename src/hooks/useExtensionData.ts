import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";

/**
 * Hook to get extension data for an app
 */
export function useExtensionData(
  extensionId: string,
  appId: number | null,
  key: string,
) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["extension-data", extensionId, appId, key],
    queryFn: async () => {
      if (!appId) return null;
      const ipcClient = IpcClient.getInstance() as any;
      return await ipcClient.ipcRenderer.invoke("extension:get-data", {
        extensionId,
        appId,
        key,
      });
    },
    enabled: !!appId,
  });

  return { data, isLoading, error };
}

/**
 * Hook to get all extension data for an app
 */
export function useAllExtensionData(extensionId: string, appId: number | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["extension-data-all", extensionId, appId],
    queryFn: async () => {
      if (!appId) return {};
      const ipcClient = IpcClient.getInstance() as any;
      return await ipcClient.ipcRenderer.invoke("extension:get-all-data", {
        extensionId,
        appId,
      });
    },
    enabled: !!appId,
  });

  return { data: data || {}, isLoading, error };
}
