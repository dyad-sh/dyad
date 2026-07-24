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
  /** The version the machine believes is checked out in Git. */
  checkedOutVersionId: string | null;
  /** A close/app-switch request received while a mutation was in flight. */
  exitIntent: ExitIntent;
  /** Presentation only. Never used to decide Git transitions. */
  selectedDiffFile: { versionId: string; path: string } | null;
  /** Whether the Code panel should show the version diff for targetVersionId. */
  isDiffVisible: boolean;
}

export type BranchSwitchFallback =
  | { type: "closed" }
  | { type: "viewing-diff"; session: PreviewSession }
  | { type: "browsing"; session: PreviewSession }
  | { type: "previewing"; session: PreviewSession }
  | { type: "recovery-required"; session: PreviewSession; error: PreviewError };

export type PreviewState =
  | { type: "closed" }
  | { type: "viewing-diff"; session: PreviewSession }
  | { type: "browsing"; session: PreviewSession }
  | { type: "resolving-origin"; session: PreviewSession }
  | { type: "checking-out"; session: PreviewSession }
  | { type: "previewing"; session: PreviewSession }
  | {
      type: "restoring";
      session: PreviewSession;
      fallback: "closed" | "browsing" | "previewing";
    }
  | { type: "returning"; session: PreviewSession }
  | {
      type: "switching-branch";
      appId: number;
      branch: string;
      fallback: BranchSwitchFallback;
    }
  | { type: "recovery-required"; session: PreviewSession; error: PreviewError };

export type PreviewEvent =
  // UI intents
  | { type: "OPEN"; appId: number }
  | { type: "CLOSE" }
  | { type: "APP_CHANGED"; nextAppId: number | null }
  | { type: "SELECT_VERSION"; versionId: string }
  | { type: "CLOSE_VERSION_DIFF" }
  | { type: "SWITCH_BRANCH"; appId: number; branch: string }
  | {
      type: "VIEW_VERSION_DIFF";
      appId: number;
      versionId: string;
      file: { versionId: string; path: string } | null;
    }
  | {
      type: "SELECT_DIFF_FILE";
      file: { versionId: string; path: string } | null;
    }
  | {
      type: "RESTORE";
      appId: number;
      versionId: string;
      expectedHeadOid?: string;
      currentChatMessageId?: { chatId: number; messageId: number };
    }
  | {
      type: "RESTORE_TO_MESSAGE";
      appId: number;
      chatId: number;
      messageId: number;
      restoreCodebase: boolean;
    }
  | { type: "RETRY_RETURN" }
  // Command completions (dispatched only by the controller)
  | { type: "ORIGIN_RESOLVED"; branch: string }
  | { type: "ORIGIN_RESOLUTION_FAILED" }
  | { type: "CHECKOUT_SUCCEEDED" }
  | { type: "CHECKOUT_FAILED"; error: PreviewError }
  | {
      type: "RESTORE_SUCCEEDED";
      repositoryOutcome: "target-applied" | "unchanged";
    }
  | { type: "RESTORE_FAILED"; error: PreviewError }
  | { type: "RETURN_SUCCEEDED" }
  | { type: "RETURN_FAILED"; error: PreviewError }
  | { type: "SWITCH_BRANCH_SUCCEEDED" }
  | { type: "SWITCH_BRANCH_FAILED"; error: PreviewError };

export type PreviewCommand =
  | { type: "resolve-origin"; appId: number }
  | {
      type: "checkout";
      appId: number;
      versionId: string;
    }
  | { type: "return"; appId: number; branch: string }
  | { type: "switch-branch"; appId: number; branch: string }
  | {
      type: "restore";
      appId: number;
      versionId: string;
      targetBranch: string | null;
      expectedHeadOid?: string;
      currentChatMessageId?: { chatId: number; messageId: number };
    }
  | {
      type: "restore-to-message";
      appId: number;
      chatId: number;
      messageId: number;
      restoreCodebase: boolean;
      targetBranch: string | null;
    }
  | { type: "notify-error"; message: string }
  | { type: "notify-recovery"; appId: number; error: PreviewError }
  | { type: "dismiss-recovery"; appId: number };

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
    case "viewing-diff":
    case "returning":
    case "switching-branch":
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
    case "switching-branch":
      return true;
    case "closed":
    case "viewing-diff":
    case "browsing":
    case "resolving-origin":
    case "previewing":
    case "recovery-required":
      return false;
  }
}

function canShowDiff(
  state: PreviewState,
): state is Exclude<
  PreviewState,
  | { type: "closed" }
  | { type: "returning"; session: PreviewSession }
  | { type: "switching-branch" }
  | { type: "recovery-required"; session: PreviewSession; error: PreviewError }
> {
  return (
    state.type !== "closed" &&
    state.type !== "returning" &&
    state.type !== "switching-branch" &&
    state.type !== "recovery-required"
  );
}

/**
 * The version whose diff the UI should display for this state, or null.
 * Presentation-only; never used to decide Git transitions.
 */
export function diffVersionIdForState(state: PreviewState): string | null {
  if (!canShowDiff(state)) return null;
  return state.session.isDiffVisible ? state.session.targetVersionId : null;
}

export function selectedDiffFileForState(
  state: PreviewState,
): PreviewSession["selectedDiffFile"] {
  return canShowDiff(state) ? state.session.selectedDiffFile : null;
}
