import { useEffect } from "react";
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

  useEffect(() => {
    if (selectedAppId == null) {
      return;
    }
    void ipc.app.recordViewedAppSize(selectedAppId).catch(() => {
      // Telemetry only; a failure here must not surface to the user.
    });
  }, [selectedAppId]);
}
