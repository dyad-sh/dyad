import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { useSetAtom } from "jotai";
import { activeCheckoutCounterAtom } from "@/store/appAtoms";

interface CheckoutVersionVariables {
  appId: number;
  versionId: string;
}

export function useCheckoutVersion() {
  const queryClient = useQueryClient();
  const setActiveCheckouts = useSetAtom(activeCheckoutCounterAtom);

  const { isPending: isCheckingOutVersion, mutateAsync: checkoutVersion } =
    useMutation<void, Error, CheckoutVersionVariables>({
      mutationFn: async ({ appId, versionId }) => {
        if (appId === null) {
          // Should be caught by UI logic before calling, but as a safeguard.
          throw new Error("App ID is null, cannot checkout version.");
        }
        const ipcClient = IpcClient.getInstance();
        setActiveCheckouts((prev) => prev + 1); // Increment counter
        try {
          await ipcClient.checkoutVersion({ appId, versionId });
        } finally {
          setActiveCheckouts((prev) => prev - 1); // Decrement counter
        }
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
