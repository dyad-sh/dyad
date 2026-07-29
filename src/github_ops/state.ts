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

import type {
  CorrelatedOperationOutcome,
  OperationDisposalCause,
} from "@/distributed_machines/operation_registry";
import type { RequestId } from "@/distributed_machines/request_identity";

export type PushMode = "normal" | "force" | "lease";

export type ConnectRepositoryOperation =
  | {
      type: "connect-repo";
      mode: "create";
      org: string;
      repo: string;
      branch?: string;
      thenAutoPush: boolean;
    }
  | {
      type: "connect-repo";
      mode: "existing";
      owner: string;
      repo: string;
      branch: string;
      thenAutoPush: boolean;
    };

export type GithubOperation =
  | { type: "push"; mode: PushMode }
  | { type: "pull" }
  | { type: "fetch" }
  | { type: "rebase" }
  | { type: "rebase-continue" }
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

export type GithubOpsBanner = {
  kind: "success" | "error" | "info";
  code?: string;
  completedOperation?: GithubOperation["type"];
  message: string;
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
  | { type: "OP_SUCCEEDED"; op: GithubOperation }
  | {
      type: "OP_FAILED";
      op: GithubOperation;
      failure: GithubOperationFailure;
    }
  | { type: "CONFLICTS"; files: readonly string[] }
  | {
      type: "GIT_STATE";
      mergeInProgress: boolean;
      rebaseInProgress: boolean;
    }
  | { type: "ABORT_AND_SWITCH_CONFIRMED" }
  | { type: "BLOCKED_DISMISSED" }
  | { type: "RESOLVE_WITH_AI_STARTED" }
  | { type: "BANNER_DISMISSED" }
  | { type: "RECONCILE_REQUESTED" };

export type GithubOpsCommand =
  | { type: "run-op"; op: GithubOperation }
  | { type: "probe-git-state" }
  | { type: "probe-conflicts"; settleOnError?: boolean }
  | { type: "invalidate-branches" }
  | { type: "refresh-app" }
  | {
      type: "notify";
      kind: "success" | "error" | "info";
      message: string;
    }
  | {
      type: "record-operation-route";
      operationId: string;
      windowSessionId: string;
    }
  | { type: "start-conflict-resolution"; files: readonly string[] };

export type GithubOpsIgnoreReason =
  | "op-in-flight"
  | "blocked-by-conflicts"
  | "invalid-in-current-state"
  | "stale-op"
  | "no-change";

export type GithubOpsOperationKind = GithubOperation["type"];

export type GithubOpsOperationOutcome =
  | {
      readonly kind: "succeeded";
      readonly operation: GithubOpsOperationKind;
    }
  | {
      readonly kind: "failed";
      readonly operation: GithubOpsOperationKind | "unknown";
      readonly failure: GithubOperationFailure;
    }
  | {
      readonly kind: "cancelled";
      readonly reason:
        | "superseded"
        | "actor-disposed"
        | "app-disposed"
        | "machine-disposed"
        | "host-disposed"
        | "window-disposed";
    }
  | {
      readonly kind: "rejected";
      readonly reason: GithubOpsIgnoreReason | "stale-operation";
    };

export type GithubOpsCorrelatedOutcome = CorrelatedOperationOutcome<
  GithubOpsOperationOutcome,
  import("./transport").GithubOpsInvocationRef
>;

export function githubOpsDisposalReason(
  cause: OperationDisposalCause,
): Extract<GithubOpsOperationOutcome, { kind: "cancelled" }>["reason"] {
  switch (cause) {
    case "actor":
      return "actor-disposed";
    case "key":
      return "app-disposed";
    case "machine":
      return "machine-disposed";
    case "host":
      return "host-disposed";
    case "window-session":
      return "window-disposed";
  }
}

export interface GithubOpsOperationOwnership {
  readonly requestId: RequestId;
  readonly invocationRef: import("./transport").GithubOpsInvocationRef;
}

export type GithubOpsTransitionResult =
  import("@/state_machines/types").TransitionResult<
    GithubOpsState,
    GithubOpsCommand,
    GithubOpsIgnoreReason
  >;
