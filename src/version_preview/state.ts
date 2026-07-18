/**
 * Domain model for the Version History preview workflow.
 *
 * These types are plain TypeScript with no runtime imports so the model can
 * move between the renderer and the main process unchanged. See
 * plans/version-preview-state-machine.md for the full design.
 */

export type ExitIntent =
  | { type: "none" }
  | { type: "close" }
  | { type: "switch-app"; nextAppId: number | null };

export interface PreviewError {
  message: string;
}

export interface PreviewSession {
  /** The app that owns this session. Never substituted after creation. */
  appId: number;
  /**
   * The branch that was live before the first historical checkout. Captured
   * exactly once per session and immutable afterwards.
   */
  originBranch: string | null;
  /** The version the user most recently asked to preview or restore. */
  targetVersionId: string | null;
  /** Whether the target version has a database snapshot to restore. */
  targetHasDbSnapshot: boolean;
  /** The version the machine believes is checked out in Git. */
  checkedOutVersionId: string | null;
  /** A close/app-switch request received while a mutation was in flight. */
  exitIntent: ExitIntent;
}

export type PreviewState =
  | { type: "closed" }
  | { type: "browsing"; session: PreviewSession }
  | { type: "resolving-origin"; session: PreviewSession }
  | { type: "checking-out"; session: PreviewSession }
  | { type: "previewing"; session: PreviewSession }
  | { type: "restoring"; session: PreviewSession }
  | { type: "returning"; session: PreviewSession }
  | { type: "recovery-required"; session: PreviewSession; error: PreviewError };

export type PreviewEvent =
  // UI intents
  | { type: "OPEN"; appId: number }
  | { type: "CLOSE" }
  | { type: "APP_CHANGED"; nextAppId: number | null }
  | { type: "SELECT_VERSION"; versionId: string; hasDbSnapshot: boolean }
  | { type: "RESTORE"; versionId: string; hasDbSnapshot: boolean }
  | { type: "RETRY_RETURN" }
  // Command completions (dispatched only by the controller)
  | { type: "ORIGIN_RESOLVED"; branch: string }
  | { type: "ORIGIN_RESOLUTION_FAILED" }
  | { type: "CHECKOUT_SUCCEEDED" }
  | { type: "CHECKOUT_FAILED"; error: PreviewError }
  | { type: "RESTORE_SUCCEEDED" }
  | { type: "RESTORE_FAILED"; error: PreviewError }
  | { type: "RETURN_SUCCEEDED" }
  | { type: "RETURN_FAILED"; error: PreviewError };

export type PreviewCommand =
  | { type: "resolve-origin"; appId: number }
  | {
      type: "checkout";
      appId: number;
      versionId: string;
      hasDbSnapshot: boolean;
    }
  | { type: "return"; appId: number; branch: string }
  | {
      type: "restore";
      appId: number;
      versionId: string;
      targetBranch: string;
      hasDbSnapshot: boolean;
    }
  | { type: "notify-error"; message: string };

/** Stable singleton for the closed state so snapshots compare by identity. */
export const CLOSED_STATE: PreviewState = { type: "closed" };

/** States in which the Version History pane is shown. */
export function isPaneVisibleState(state: PreviewState): boolean {
  switch (state.type) {
    case "browsing":
    case "resolving-origin":
    case "checking-out":
    case "previewing":
    case "restoring":
      return true;
    case "closed":
    case "returning":
    case "recovery-required":
      return false;
  }
}

/** States in which a Git-mutating command is (or may be) in flight. */
export function isMutatingState(state: PreviewState): boolean {
  switch (state.type) {
    case "checking-out":
    case "restoring":
    case "returning":
      return true;
    case "closed":
    case "browsing":
    case "resolving-origin":
    case "previewing":
    case "recovery-required":
      return false;
  }
}

/**
 * The version whose diff the UI should display for this state, or null.
 * Presentation-only; never used to decide Git transitions.
 */
export function diffVersionIdForState(state: PreviewState): string | null {
  switch (state.type) {
    case "resolving-origin":
    case "checking-out":
    case "previewing":
    case "restoring":
      return state.session.targetVersionId;
    case "closed":
    case "browsing":
    case "returning":
    case "recovery-required":
      return null;
  }
}
