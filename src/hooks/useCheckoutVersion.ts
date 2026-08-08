import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { useSetAtom } from "jotai";
import { activeCheckoutCounterAtom } from "@/store/appAtoms";
import { queryKeys } from "@/lib/queryKeys";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { useRunApp } from "./useRunApp";
import { useSettings } from "./useSettings";

interface CheckoutVersionVariables {
  appId: number;
  versionId: string;
}

export function useCheckoutVersion() {
  const queryClient = useQueryClient();
  const setActiveCheckouts = useSetAtom(activeCheckoutCounterAtom);
  const { restartApp } = useRunApp();
  const { settings } = useSettings();

  const { isPending: isCheckingOutVersion, mutateAsync: checkoutVersion } =
    useMutation<void, Error, CheckoutVersionVariables>({
      mutationFn: async ({ appId, versionId }) => {
        if (appId === null) {
          // Should be caught by UI logic before calling, but as a safeguard.
          throw new DyadError(
            "App ID is null, cannot checkout version.",
            DyadErrorKind.External,
          );
        }
        setActiveCheckouts((prev) => prev + 1); // Increment counter
        try {
          await ipc.version.checkoutVersion({ appId, versionId });
        } finally {
          setActiveCheckouts((prev) => prev - 1); // Decrement counter
        }
      },
      onSuccess: async (_, variables) => {
        // Invalidate queries that depend on the current version/branch
        await queryClient.invalidateQueries({
          queryKey: queryKeys.branches.current({ appId: variables.appId }),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.versions.list({ appId: variables.appId }),
        });
        if (settings?.runtimeMode2 === "cloud") {
          await restartApp();
        }
      },
      meta: { showErrorToast: true },
    });

  return {
    checkoutVersion,
    isCheckingOutVersion,
  };
}
