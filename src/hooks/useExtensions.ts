import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";

/**
 * Extension metadata from main process
 */
export interface ExtensionMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  ui?: {
    settingsPage?: {
      component: string;
      title: string;
      icon?: string;
    };
    appConnector?: {
      component: string;
      title: string;
    };
  };
}

/**
 * Hook to get list of loaded extensions
 * Note: This requires an IPC handler to be implemented in the main process
 */
export function useExtensions() {
  const {
    data: extensions = [],
    isLoading,
    error,
  } = useQuery<ExtensionMetadata[]>({
    queryKey: ["extensions"],
    queryFn: async () => {
      // For now, return empty array until IPC handler is implemented
      // TODO: Implement "extension:list" IPC handler in main process
      try {
        const ipcClient = IpcClient.getInstance() as any;
        return (await ipcClient.ipcRenderer.invoke("extension:list")) || [];
      } catch {
        // Handler not implemented yet, return empty array
        return [];
      }
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return {
    extensions,
    isLoading,
    error,
  };
}
