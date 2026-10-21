/**
 * Pure domain types for the per-app GitHub operation machine.
 *
 * Concurrency policy: one operation may run per app. User requests received
 * while `running` are ignored; `next` is reserved for machine-owned
 * composites (rebase→push, create→switch, connect→push, abort→switch).
 *
 * Dependency graph: github_ops has no machine dependencies. Conflict
 * resolution is reached through an injected command runner at the app
 * composition root.
 */

export type PushMode = "normal" | "force" | "lease";

/** Which hosting provider an operation talks to. */
export type GitRemoteProviderName = "github" | "gitlab";

/** Linking an app to a repository on one of the supported providers. */
export type ConnectRepositoryOperation =
  | {
      type: "connect-repo";
      provider: "github";
      mode: "create";
      org: string;
      repo: string;
      branch?: string;
      thenAutoPush: boolean;
    }
  | {
      type: "connect-repo";
      provider: "github";
      mode: "existing";
      owner: string;
      repo: string;
      branch: string;
      thenAutoPush: boolean;
    }
  | {
      type: "connect-repo";
      provider: "gitlab";
      mode: "create";
      /** Where the project is created: a group or the user's own namespace. */
      namespaceId: number;
      repo: string;
      branch?: string;
      thenAutoPush: boolean;
    }
  | {
      type: "connect-repo";
      provider: "gitlab";
      mode: "existing";
      projectId: number;
      branch: string;
      thenAutoPush: boolean;
    };

export type GithubOperation =
  // The operation itself is plain git either way; `provider` names who the
  // remote belongs to, for the banner the machine composes. It is required
  // rather than optional on purpose: an optional field had to be re-attached
  // by hand at every composite edge, and `rebase-continue` was missed — a
  // resumed rebase on a GitLab app announced a push to GitHub. Required, the
  // compiler finds the next such gap instead of a user finding it.
  | { type: "push"; mode: PushMode; provider: GitRemoteProviderName }
  | { type: "pull"; provider: GitRemoteProviderName }
  | { type: "fetch"; provider: GitRemoteProviderName }
  | { type: "rebase"; provider: GitRemoteProviderName }
  | { type: "rebase-continue"; provider: GitRemoteProviderName }
  | { type: "rebase-abort" }
  | { type: "merge-abort" }
  | { type: "merge"; branch: string }
  | { type: "switch"; branch: string }
  | {
      type: "create-branch";
      name: string;
      from?: string;
      thenSwitch: boolean;
    }
  | { type: "delete-branch"; branch: string }
  | { type: "rename-branch"; oldBranch: string; newBranch: string }
  | { type: "disconnect" }
  | ConnectRepositoryOperation;

export type GithubOperationFailure = {
  code?: string;
  kind: string;
  message: string;
};

/**
 * Why a sync left the remote where it did. `pushed`, `up-to-date`, and
 * `uncommitted-changes` mean the user's current commit is on the remote
 * branch; the other three mean it is not, and say why when that is known.
 */
export type PushOutcome =
  | "pushed"
  | "up-to-date"
  | "uncommitted-changes"
  | "wrong-branch"
  | "detached-head"
  | "unverified";

export type PushedFileCounts = {
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
};

/**
 * What one sync did, measured from git before and after the push. Produced in
 * the main process, carried on the success event, and read by the banner.
 */
export type PushSummary = {
  outcome: PushOutcome;
  /** The branch Dyad pushed: the one stored on the app row. */
  pushedBranch: string;
  /** The branch HEAD is on, or null when detached. */
  currentBranch: string | null;
  /** Commits the push added to the remote branch; null when unmeasurable. */
  commitsPushed: number | null;
  /** File-level changes across the pushed commits; null when nothing moved. */
  files: PushedFileCounts | null;
  /** Working-tree changes no commit contains yet. */
  uncommittedFiles: number;
  /** Commits reachable from HEAD that the remote branch does not have. */
  commitsNotOnRemote: number;
  /** Abbreviated commit the user is on. */
  head: string;
  /** Abbreviated remote branch tip after the push, or null if unknown. */
  remoteTip: string | null;
};

export type GithubOperationResult = { type: "push"; summary: PushSummary };

export type GithubOpsBanner = {
  kind: "success" | "error" | "info" | "warning";
  code?: string;
  completedOperation?: GithubOperation["type"];
  message: string;
  /** A second, smaller line under `message` with the specifics. */
  detail?: string;
};

interface GithubOpsContext {
  banner: GithubOpsBanner | null;
}

export type ConflictOrigin = GithubOperation | { type: "reconcile" };
export type BlockingOperation = "merge" | "rebase";
export type BlockedSwitchResume =
  | {
      type: "conflicted";
      files: readonly string[];
      origin: ConflictOrigin;
    }
  | { type: "rebase-paused" };

export type GithubOpsState =
  | ({ type: "idle" } & GithubOpsContext)
  | ({
      type: "running";
      op: GithubOperation;
      next?: GithubOperation;
      /**
       * A coded failure can require an unlocked conflict probe before the
       * machine knows whether it should enter `conflicted`.
       */
      awaitingConflicts?: boolean;
      blockedSwitchResume?: BlockedSwitchResume;
    } & GithubOpsContext)
  | ({
      type: "conflicted";
      files: readonly string[];
      origin: ConflictOrigin;
      resolution?:
        | "resolving"
        | "checking"
        | "verification-failed"
        | "ready-to-sync";
      resolutionChatId?: number;
      verificationAttempt?: number;
      verificationError?: string;
    } & GithubOpsContext)
  | ({ type: "rebase-paused" } & GithubOpsContext)
  | ({
      type: "switch-blocked";
      target: string;
      blockingOp: BlockingOperation;
      hasConflicts: boolean;
      resume?: BlockedSwitchResume;
    } & GithubOpsContext);

export const INITIAL_GITHUB_OPS_STATE: GithubOpsState = {
  type: "idle",
  banner: null,
};

export type GithubOpsEvent =
  | { type: "OP_REQUESTED"; op: GithubOperation }
  // `result` is present only for operations that measure what they did; a
  // push without one (an older producer, or a test) keeps the plain banner.
  | {
      type: "OP_SUCCEEDED";
      op: GithubOperation;
      result?: GithubOperationResult;
    }
  | {
      type: "OP_FAILED";
      op: GithubOperation;
      failure: GithubOperationFailure;
    }
  // Both probes report whose remote the app is linked to, read from the app
  // row: a rebase git reports in progress was not started by an operation the
  // machine knows about, so this is the only place its provider can come
  // from. Null when the app has no linked remote, or when a failed conflicts
  // probe settles with no files.
  | {
      type: "CONFLICTS";
      files: readonly string[];
      provider: GitRemoteProviderName | null;
      verificationAttempt?: number;
    }
  | {
      type: "GIT_STATE";
      mergeInProgress: boolean;
      rebaseInProgress: boolean;
      provider: GitRemoteProviderName | null;
      verificationAttempt?: number;
    }
  | { type: "ABORT_AND_SWITCH_CONFIRMED" }
  | { type: "BLOCKED_DISMISSED" }
  | { type: "RESOLVE_WITH_AI_STARTED" }
  | { type: "CONFLICT_RESOLUTION_STARTED"; chatId: number }
  | { type: "CONFLICT_RESOLUTION_FINISHED"; chatId: number }
  | {
      type: "CONFLICT_VERIFICATION_FAILED";
      verificationAttempt: number;
      message: string;
    }
  | { type: "RETRY_CONFLICT_VERIFICATION" }
  | { type: "BANNER_DISMISSED" }
  | { type: "RECONCILE_REQUESTED" };

export type GithubOpsCommand =
  | { type: "run-op"; op: GithubOperation }
  | { type: "probe-git-state"; verificationAttempt?: number }
  | {
      type: "probe-conflicts";
      settleOnError?: boolean;
      verificationAttempt?: number;
    }
  | { type: "invalidate-branches" }
  | { type: "refresh-app" }
  | {
      type: "notify";
      kind: "success" | "error" | "info";
      message: string;
    }
  | { type: "start-conflict-resolution"; files: readonly string[] };

export type GithubOpsIgnoreReason =
  | "op-in-flight"
  | "blocked-by-conflicts"
  | "invalid-in-current-state"
  | "stale-op"
  | "no-change";

export type GithubOpsTransitionResult =
  import("@/state_machines/types").TransitionResult<
    GithubOpsState,
    GithubOpsCommand,
    GithubOpsIgnoreReason
  >;
