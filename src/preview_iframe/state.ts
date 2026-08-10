/**
 * Per-app preview iframe identity, navigation, and picker state.
 *
 * The machine has no timers or async operations. Events are processed in
 * arrival order; none are dropped as stale. Iframe DOM access and the selected
 * component list remain adapter-owned and are deliberately absent here.
 *
 * Machine dependency graph: preview_iframe -> none.
 */

/**
 * Who put the preview on the route it is showing.
 *
 * "dyad" — the user chose it through Dyad's chrome (address bar, back/forward,
 * a restored presentation). "app" — the previewed app navigated itself, e.g. a
 * redirect or a click inside the page. "none" — nothing has navigated yet.
 *
 * The recorder is what needs the distinction. Starting a recording passes the
 * current route as the session's opening `goto`, which is right for a route the
 * user deliberately selected and wrong for one the app arrived at on its own:
 * pinning the test to the *destination* of a redirect skips the redirect, which
 * may be the behaviour under test.
 */
export type PreviewRouteSource = "none" | "dyad" | "app";

export interface PreviewIframeState {
  readonly history: readonly string[];
  readonly position: number;
  readonly currentUrl: string | null;
  readonly currentUrlSource: PreviewRouteSource;
  readonly preservedUrl: string | null;
  readonly iframeEpoch: number;
  readonly selectorReady: boolean;
  readonly picking: boolean;
  readonly restoreQueued: boolean;
  readonly preserveHistoryOnNextReplacement: boolean;
  readonly error: PreviewError | undefined;
}

export interface PreviewError {
  readonly message: string;
  readonly source: "preview-app" | "dyad-app" | "dyad-sync";
}

export const INITIAL_PREVIEW_IFRAME_STATE: PreviewIframeState = {
  history: [],
  position: 0,
  currentUrl: null,
  currentUrlSource: "none",
  preservedUrl: null,
  iframeEpoch: 0,
  selectorReady: false,
  picking: false,
  restoreQueued: false,
  preserveHistoryOnNextReplacement: false,
  error: undefined,
};

export type PreviewIframeEvent =
  | {
      type: "RESTORE_PRESENTATION";
      history: readonly string[];
      position: number;
      preserveHistoryOnNextReplacement?: boolean;
    }
  | { type: "APP_URL_CHANGED"; url: string }
  | { type: "NAVIGATE"; path: string }
  | {
      type: "NAVIGATED_IN_APP";
      kind: "pushState" | "replaceState";
      url: string;
    }
  | { type: "GO_BACK" }
  | { type: "GO_FORWARD" }
  | { type: "RUNTIME_RESTARTED" }
  | { type: "RELOAD_REQUESTED" }
  | { type: "IFRAME_REPLACED"; reason: "external" }
  | { type: "IFRAME_LOADED" }
  | { type: "SELECTOR_READY" }
  | { type: "PICKER_TOGGLED" }
  | { type: "PICKER_DEACTIVATED" }
  | { type: "SELECTION_RESTORE_QUEUED" }
  | { type: "SELECTION_RESTORED" }
  | {
      type: "IFRAME_ERROR";
      message: string;
      source: "preview-app" | "dyad-app";
    }
  | { type: "SYNC_ERROR"; message: string }
  | { type: "SYNC_RECOVERED" }
  | { type: "APP_ERROR"; message: string }
  | { type: "APP_ERROR_CLEARED" }
  | { type: "DISMISS" };

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

export type PreviewIframeCommand = {
  type: "post-to-iframe";
  message: PreviewIframePostMessage;
};

export type PreviewIframeIgnoreReason =
  | "already-current-app-url"
  | "already-current-url"
  | "empty-url"
  | "history-boundary"
  | "already-runtime-reset"
  | "picker-not-ready"
  | "picker-already-inactive"
  | "already-selector-ready"
  | "already-replaced"
  | "restore-already-queued"
  | "restore-not-queued"
  | "higher-priority-error"
  | "no-sync-error"
  | "same-preview-error"
  | "no-preview-error";

export const selectCanGoBack = (state: PreviewIframeState): boolean =>
  state.position > 0;

export const selectCanGoForward = (state: PreviewIframeState): boolean =>
  state.position < state.history.length - 1;

export const selectPreviewError = (
  state: PreviewIframeState,
): PreviewError | undefined => state.error;

export const selectIframeSrc = (
  state: PreviewIframeState,
  appUrl: string | null,
): string | undefined => {
  if (!appUrl) return undefined;
  const candidate = state.preservedUrl ?? state.currentUrl ?? appUrl;
  try {
    return new URL(candidate).origin === new URL(appUrl).origin
      ? candidate
      : appUrl;
  } catch {
    return appUrl;
  }
};
