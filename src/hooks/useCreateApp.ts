import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { CreateAppParams, CreateAppResult } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";

export function useCreateApp() {
  const queryClient = useQueryClient();

  const mutation = useMutation<CreateAppResult, Error, CreateAppParams>({
    mutationFn: async (params: CreateAppParams) => {
      if (!params.name.trim()) {
        throw new Error("App name is required");
      }

      return ipc.app.createApp(params);
    },
    onSuccess: () => {
      // Invalidate apps list to trigger refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
    },
    onError: (error) => {
      showError(error);
    },
  });

  const createApp = async (
    params: CreateAppParams,
  ): Promise<CreateAppResult> => {
    return mutation.mutateAsync(params);
  };

  return {
    createApp,
    isCreating: mutation.isPending,
    error: mutation.error,
  };
}
