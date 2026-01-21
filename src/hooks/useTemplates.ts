import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { localTemplatesData, type Template } from "@/shared/templates";
import { queryKeys } from "@/lib/queryKeys";

export function useTemplates() {
  const query = useQuery({
    queryKey: queryKeys.templates.all,
    queryFn: async (): Promise<Template[]> => {
      return ipc.template.getTemplates();
    },
    placeholderData: localTemplatesData,
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
