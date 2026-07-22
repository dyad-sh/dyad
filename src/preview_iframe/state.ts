/**
 * Per-app preview iframe identity, navigation, and picker state.
 *
 * The machine has no timers or async operations. Events are processed in
 * arrival order; none are dropped as stale. Iframe DOM access and the selected
 * component list remain adapter-owned and are deliberately absent here.
 *
 * Machine dependency graph: preview_iframe -> none.
 */

export interface PreviewIframeState {
  readonly history: readonly string[];
  readonly position: number;
  readonly currentUrl: string | null;
  readonly preservedUrl: string | null;
  readonly iframeEpoch: number;
  readonly selectorReady: boolean;
  readonly picking: boolean;
  readonly restoreQueued: boolean;
}

export const INITIAL_PREVIEW_IFRAME_STATE: PreviewIframeState = {
  history: [],
  position: 0,
  currentUrl: null,
  preservedUrl: null,
  iframeEpoch: 0,
  selectorReady: false,
  picking: false,
  restoreQueued: false,
};

export type PreviewIframeEvent =
  | { type: "APP_URL_CHANGED"; url: string }
  | { type: "NAVIGATE"; path: string }
  | {
      type: "NAVIGATED_IN_APP";
      kind: "pushState" | "replaceState";
      url: string;
    }
  | { type: "GO_BACK" }
  | { type: "GO_FORWARD" }
  | { type: "RELOAD_REQUESTED" }
  | { type: "IFRAME_REPLACED"; reason: "external" }
  | { type: "IFRAME_LOADED" }
  | { type: "SELECTOR_READY" }
  | { type: "PICKER_TOGGLED" }
  | { type: "PICKER_DEACTIVATED" }
  | { type: "SELECTION_RESTORE_QUEUED" }
  | { type: "SELECTION_RESTORED" };

export type PreviewIframePostMessage =
  | {
      type: "navigate";
      payload: {
        url: string;
        direction?: "backward" | "forward";
      };
    }
  | { type: "activate-dyad-component-selector" }
  | { type: "deactivate-dyad-component-selector" }
  | { type: "cleanup-all-text-editing" }
  | { type: "restore-overlays" };

export type PreviewIframeCommand =
  | { type: "post-to-iframe"; message: PreviewIframePostMessage }
  | { type: "clear-preview-error" };

export type PreviewIframeIgnoreReason =
  | "already-current-app-url"
  | "already-current-url"
  | "empty-url"
  | "history-boundary"
  | "picker-not-ready"
  | "picker-already-inactive"
  | "already-selector-ready"
  | "restore-already-queued"
  | "restore-not-queued";

export const selectCanGoBack = (state: PreviewIframeState): boolean =>
  state.position > 0;

export const selectCanGoForward = (state: PreviewIframeState): boolean =>
  state.position < state.history.length - 1;

export const selectIframeSrc = (
  state: PreviewIframeState,
): string | undefined => {
  const candidate = state.preservedUrl ?? state.currentUrl ?? undefined;
  const base = state.history[0];
  if (!candidate || !base) return candidate;
  try {
    return new URL(candidate).origin === new URL(base).origin
      ? candidate
      : base;
  } catch {
    return base;
  }
};
