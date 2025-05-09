import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";

interface CheckoutVersionVariables {
  appId: number;
  versionId: string;
}

export function useCheckoutVersion() {
  const queryClient = useQueryClient();

  const { isPending: isCheckingOutVersion, mutateAsync: checkoutVersion } =
    useMutation<void, Error, CheckoutVersionVariables>({
      mutationFn: async ({ appId, versionId }) => {
        if (appId === null) {
          // Should be caught by UI logic before calling, but as a safeguard.
          throw new Error("App ID is null, cannot checkout version.");
        }
        const ipcClient = IpcClient.getInstance();
        await ipcClient.checkoutVersion({ appId, versionId });
      },
      onSuccess: (_, variables) => {
        // Invalidate queries that depend on the current version/branch
        queryClient.invalidateQueries({
          queryKey: ["currentBranch", variables.appId],
        });
        queryClient.invalidateQueries({
          queryKey: ["versions", variables.appId],
        });
      },
      meta: { showErrorToast: true },
    });

  return {
    checkoutVersion,
    isCheckingOutVersion,
  };
}
