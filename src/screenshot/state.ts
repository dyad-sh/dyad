/**
 * Per-app preview screenshot pipeline.
 *
 * Dependency graph: producer inbox -> screenshot -> shared preview adapter.
 * The screenshot machine never imports another machine's controller. The
 * pendingScreenshotAppIdsAtom is a consumed producer mailbox, not tracked
 * machine state; its entries are cleared as soon as CAPTURE_REQUESTED is
 * accepted by the per-app controller.
 *
 * Staleness policy: while work has not reached commit resolution, a newer
 * request supersedes the current source. Once an async capture is in flight,
 * only the latest newer source is queued. Responses with any other requestId
 * are stale and ignored.
 */

export type ScreenshotCaptureSource = "commit" | "stream" | "fallback";

interface ScreenshotContext {
  readonly fallbackChecked: boolean;
  readonly iframeLoaded: boolean;
  readonly selectorReady: boolean;
  readonly queuedSource: ScreenshotCaptureSource | null;
}

export type ScreenshotState =
  | (ScreenshotContext & { readonly status: "idle" })
  | (ScreenshotContext & {
      readonly status: "pending";
      readonly source: ScreenshotCaptureSource;
    })
  | (ScreenshotContext & {
      readonly status: "waitingSelectorReady";
      readonly source: ScreenshotCaptureSource;
    })
  | (ScreenshotContext & {
      readonly status: "settling";
      readonly source: ScreenshotCaptureSource;
    })
  | (ScreenshotContext & {
      readonly status: "resolvingCommit";
      readonly source: ScreenshotCaptureSource;
    })
  | (ScreenshotContext & {
      readonly status: "awaitingResponse";
      readonly source: ScreenshotCaptureSource;
      readonly requestId: string;
      readonly commitHash: string;
    })
  | (ScreenshotContext & {
      readonly status: "saving";
      readonly source: ScreenshotCaptureSource;
      readonly commitHash: string;
      readonly dataUrl: string;
    });

export const INITIAL_SCREENSHOT_STATE: ScreenshotState = {
  status: "idle",
  fallbackChecked: false,
  iframeLoaded: false,
  selectorReady: false,
  queuedSource: null,
};

export type ScreenshotEvent =
  | {
      readonly type: "CAPTURE_REQUESTED";
      readonly source: ScreenshotCaptureSource;
    }
  | { readonly type: "SELECTOR_READY" }
  | { readonly type: "IFRAME_LOADED" }
  | { readonly type: "SETTLE_ELAPSED" }
  | {
      readonly type: "COMMIT_RESOLVED";
      readonly hash: string;
      readonly requestId: string;
    }
  | {
      readonly type: "RESPONSE";
      readonly requestId: string;
      readonly ok: boolean;
      readonly dataUrl?: string;
    }
  | { readonly type: "APP_HIDDEN" }
  | { readonly type: "SAVED" }
  | { readonly type: "SAVE_FAILED" };

export type ScreenshotCommand =
  | { readonly type: "schedule-settle" }
  | { readonly type: "cancel-settle" }
  | { readonly type: "resolve-commit-hash" }
  | {
      readonly type: "post-capture-request";
      readonly requestId: string;
    }
  | {
      readonly type: "save-screenshot";
      readonly commitHash: string;
      readonly dataUrl: string;
    }
  | { readonly type: "check-existing-screenshots" };

export type ScreenshotIgnoreReason =
  | "already-hidden"
  | "already-loaded"
  | "already-ready"
  | "capture-not-active"
  | "not-saving"
  | "request-already-current"
  | "stale-request";
