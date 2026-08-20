import { useCallback, useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";

import {
  previewNativeOverlayReasonsAtom,
  previewNativeViewAppIdAtom,
} from "@/atoms/previewAtoms";
import { ipc } from "@/ipc/types";

/**
 * Registers one reason for hiding the native preview surface.
 *
 * A WebContentsView composites above every pixel of renderer DOM, so anything
 * that paints over the preview panel's bounds is invisible until the native
 * view steps aside and the renderer paints the cached screenshot in its place.
 * Each surface owns a distinct `reason` so two of them (a toast during an open
 * dropdown, say) can't clear each other's request.
 *
 * The main process is told synchronously, inside the same event that opens the
 * surface, so the native view is gone before React commits the overlay — a
 * frame of the real page flashing over a menu is exactly what this avoids.
 */
export function usePreviewNativeOverlay(
  reason: string,
): (active: boolean) => void {
  const setReasons = useSetAtom(previewNativeOverlayReasonsAtom);
  const nativeViewAppId = useAtomValue(previewNativeViewAppIdAtom);
  const hasNativeView = nativeViewAppId !== null;
  const activeRef = useRef(false);

  const setOverlayActive = useCallback(
    (active: boolean) => {
      if (activeRef.current === active) return;
      activeRef.current = active;
      setReasons((current) => {
        if (current.has(reason) === active) return current;
        const next = new Set(current);
        if (active) {
          next.add(reason);
        } else {
          next.delete(reason);
        }
        // The main process only tracks the aggregate, so send on the edges of
        // "anything is overlapping" rather than per reason.
        if (current.size > 0 !== next.size > 0) {
          ipc.previewView.setOverlayActive({ active: next.size > 0 });
        }
        return next;
      });
    },
    [reason, setReasons],
  );

  // Never leave a reason latched: an unmount mid-overlay (or the native view
  // going away underneath one) would keep the surface hidden for good.
  useEffect(() => {
    if (!hasNativeView && activeRef.current) {
      setOverlayActive(false);
    }
  }, [hasNativeView, setOverlayActive]);

  useEffect(() => () => setOverlayActive(false), [setOverlayActive]);

  return setOverlayActive;
}
