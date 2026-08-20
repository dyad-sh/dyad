import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { useSonner } from "sonner";

import { previewNativeViewAppIdAtom } from "@/atoms/previewAtoms";
import { usePreviewNativeOverlay } from "./usePreviewNativeOverlay";

/**
 * Any element that portals to the document body and paints over the preview
 * panel. Dialogs, alert dialogs, menus and popovers all land here regardless of
 * which primitive rendered them, which is what keeps this from having to be
 * wired into every dialog in the app one at a time.
 */
const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  "[data-radix-popper-content-wrapper]",
  "[data-floating-ui-portal]",
].join(",");

function hasOpenOverlay(): boolean {
  return document.body.querySelector(OVERLAY_SELECTOR) !== null;
}

/**
 * Steps the native preview aside whenever renderer UI would otherwise be
 * painted underneath it.
 *
 * The native view is an Electron WebContentsView: it composites above all
 * renderer DOM, so a toast or a modal opened while it is up is invisible — a
 * failed test-run start would report itself into a void. Mounted once at the
 * app root, next to the Toaster, so every such surface is covered without each
 * one having to know the native preview exists.
 */
export function PreviewNativeOverlayGuard() {
  const nativeViewAppId = useAtomValue(previewNativeViewAppIdAtom);
  const setOverlayActive = usePreviewNativeOverlay("workbench-surface");
  const { toasts } = useSonner();
  const [hasDomOverlay, setHasDomOverlay] = useState(false);

  const hasVisibleToast = toasts.length > 0;

  // Dialogs and menus mount through portals with no shared React state to
  // subscribe to, so watch the DOM they portal into instead. Only while the
  // native view is actually up — this is otherwise pure overhead.
  useEffect(() => {
    if (nativeViewAppId === null) {
      setHasDomOverlay(false);
      return;
    }

    const sync = () => setHasDomOverlay(hasOpenOverlay());
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "data-state"],
    });
    return () => observer.disconnect();
  }, [nativeViewAppId]);

  useEffect(() => {
    setOverlayActive(
      nativeViewAppId !== null && (hasVisibleToast || hasDomOverlay),
    );
  }, [nativeViewAppId, hasVisibleToast, hasDomOverlay, setOverlayActive]);

  return null;
}
