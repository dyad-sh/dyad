import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";
import type { CreateAppParams, CreateAppResult } from "@/ipc/ipc_types";
import { useRouter } from "@tanstack/react-router";

export function useCreateApp() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const mutation = useMutation<CreateAppResult, Error, CreateAppParams>({
    mutationFn: async (params: CreateAppParams) => {
      if (!params.name.trim()) {
        throw new Error("App name is required");
      }

      const ipcClient = IpcClient.getInstance();
      return ipcClient.createApp(params);
    },
    onSuccess: (result) => {
      // Invalidate apps list to trigger refetch
      queryClient.invalidateQueries({ queryKey: ["apps"] });

      // Navigate to the new app's first chat
      router.navigate({
        to: "/chat",
        search: { id: result.chatId },
      });
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
