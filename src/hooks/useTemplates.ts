import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { localTemplatesData, type Template } from "@/shared/templates";

export function useTemplates() {
  const query = useQuery({
    queryKey: ["templates"],
    queryFn: async (): Promise<Template[]> => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getTemplates();
    },
    initialData: localTemplatesData,
    meta: {
      showErrorToast: true,
    },
  });

  return {
    templates: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
