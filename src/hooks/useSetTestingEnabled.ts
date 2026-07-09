import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Toggles the per-app E2E testing opt-in flag. On success it invalidates the
 * app-detail query so the Tests panel re-reads `app.testingEnabled` and swaps
 * between the opt-in screen and the test controls.
 */
export function useSetTestingEnabled() {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    boolean,
    Error,
    { appId: number; enabled: boolean }
  >({
    mutationFn: async ({ appId, enabled }) => {
      const result = await ipc.app.setTestingEnabled({ appId, enabled });
      return result.testingEnabled;
    },
    onSuccess: (_testingEnabled, { appId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.apps.detail({ appId }),
      });
    },
    onError: (error) => {
      showError(error.message || "Failed to update testing setting");
    },
  });

  return {
    setTestingEnabled: mutation.mutate,
    setTestingEnabledAsync: mutation.mutateAsync,
    isLoading: mutation.isPending,
  };
}
