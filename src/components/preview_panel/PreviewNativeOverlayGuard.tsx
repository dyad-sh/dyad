import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { useSonner } from "sonner";

import { previewNativeViewAppIdAtom } from "@/atoms/previewAtoms";
import { usePreviewNativeOverlay } from "./usePreviewNativeOverlay";

/**
 * Any element that portals to the document body and paints over the preview
 * panel. Dialogs, alert dialogs, menus, selects, popovers and tooltips all land
 * here regardless of which primitive rendered them, which is what keeps this
 * from having to be wired into every dialog in the app one at a time.
 */
const OVERLAY_SELECTOR = [
  // Base UI is this app's only popup primitive, and it portals every surface
  // into a container carrying `data-base-ui-portal`, marking the surface
  // `data-open` only while it is actually up. Matching the pair covers the
  // roles below plus the ones ARIA alone cannot reach: a Base UI tooltip popup
  // carries no role at all, and a *closed* select leaves a stale
  // `role="listbox"` behind in a hidden positioner — so keying on that role
  // would both miss surfaces and latch onto ones that are already gone.
  "[data-base-ui-portal] [data-open]",
  // Portalled surfaces from anything that is not Base UI. These primitives
  // unmount on close, so a bare role match cannot go stale.
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
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
      // Base UI flips `data-open`/`data-closed` in place on a popup it keeps
      // mounted, so an open or close can arrive as an attribute change with no
      // childList mutation to notice.
      attributeFilter: ["role", "data-state", "data-open", "data-closed"],
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
