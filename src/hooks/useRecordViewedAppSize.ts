import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { ipc } from "@/ipc/types";

/**
 * Reports the size of the currently selected app. Watches the atom rather than
 * the dozen places that set it, so every entry point is covered.
 * Fire-and-forget: this runs while an app is opening and must not block it.
 */
export function useRecordViewedAppSize(): void {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { mutate } = useMutation({
    mutationFn: (appId: number) => ipc.app.recordViewedAppSize(appId),
    // Telemetry only; a failure here must not surface to the user.
    onError: () => {},
  });

  useEffect(() => {
    if (selectedAppId == null) {
      return;
    }
    mutate(selectedAppId);
  }, [selectedAppId, mutate]);
}
