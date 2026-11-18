import { useMutation } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { removeNeonReconnectionDismissalsAtom } from "@/atoms/neonAtoms";
import { ipc } from "@/ipc/types";

export function useDeleteApp() {
  const removeDismissals = useSetAtom(removeNeonReconnectionDismissalsAtom);
  return useMutation({
    mutationFn: (appId: number) => ipc.app.deleteApp({ appId }),
    onSuccess: (_result, appId) => removeDismissals([appId]),
  });
}

export function useDeleteApps() {
  const removeDismissals = useSetAtom(removeNeonReconnectionDismissalsAtom);
  return useMutation({
    mutationFn: (appIds: number[]) => ipc.app.deleteApps({ appIds }),
    onSuccess: ({ results }) =>
      removeDismissals(
        results
          .filter((result) => result.success)
          .map((result) => result.appId),
      ),
  });
}
