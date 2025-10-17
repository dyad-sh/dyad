import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { localTemplatesData, type Template } from "@/shared/templates";

/**
 * A hook for fetching templates.
 * @returns {object} An object with the list of templates, loading state, error, and a function to refetch the templates.
 * @property {Template[]} templates - The list of templates.
 * @property {boolean} isLoading - Whether the templates are being loaded.
 * @property {Error | null} error - The error object if the query fails.
 * @property {() => void} refetch - A function to refetch the templates.
 */
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
