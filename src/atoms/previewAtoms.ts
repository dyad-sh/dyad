import { ComponentSelection, VisualEditingChange } from "@/ipc/types";
import { atom } from "jotai";

export const selectedComponentsPreviewAtom = atom<ComponentSelection[]>([]);

export const visualEditingSelectedComponentAtom =
  atom<ComponentSelection | null>(null);

export const currentComponentCoordinatesAtom = atom<{
  top: number;
  left: number;
  width: number;
  height: number;
} | null>(null);

export const previewIframeRefAtom = atom<HTMLIFrameElement | null>(null);

/**
 * The app whose preview is rendered in an Electron WebContentsView instead of
 * the iframe, or null when nothing is.
 *
 * Set only when a test run needs a page it can drive over CDP — the native view
 * cannot host component selection, the visual editor, the annotator, or console
 * capture, so it is never offered as a way to browse the app. Deliberately
 * session-local rather than persisted: restarting Dyad always lands back on the
 * iframe.
 *
 * Holds the owning app's id rather than a bare flag because run state is
 * per-app: with a global boolean, selecting a different app mid-run reads that
 * app's idle phase and tears the live view down (or hands the wrong app's
 * preview to a run that isn't driving it).
 */
export const previewNativeViewAppIdAtom = atom<number | null>(null);

/**
 * Reasons the native preview must currently be hidden, keyed so independent
 * surfaces can ask at the same time without clearing each other. A
 * WebContentsView composites above all renderer DOM, so *anything* painting
 * over the preview's bounds — the toolbar overflow menu, a toast, a modal —
 * has to register here or it renders underneath the native surface, invisible.
 */
export const previewNativeOverlayReasonsAtom = atom<ReadonlySet<string>>(
  new Set<string>(),
);

/**
 * Whether workbench UI is currently painting over the native preview's bounds.
 * The main process hides the WebContentsView while this is true and the
 * renderer fills the same area with its latest in-memory screenshot.
 */
export const previewNativeOverlayActiveAtom = atom(
  (get) => get(previewNativeOverlayReasonsAtom).size > 0,
);

export const annotatorModeAtom = atom<boolean>(false);

export const screenshotDataUrlAtom = atom<string | null>(null);
export const pendingVisualChangesAtom = atom<Map<string, VisualEditingChange>>(
  new Map(),
);
