import { ignore as ignoreTransition } from "@/state_machines/types";
import type {
  BlockedSwitchResume,
  BlockingOperation,
  ConflictOrigin,
  GithubOperation,
  GithubOperationFailure,
  GithubOpsBanner,
  GithubOpsCommand,
  GithubOpsEvent,
  GithubOpsIgnoreReason,
  GithubOpsState,
  GithubOpsTransitionResult,
} from "./state";
import { truncateGithubOpsErrorMessage } from "./error_message";

const PUSH_NORMAL: GithubOperation = { type: "push", mode: "normal" };

export function transition(
  state: GithubOpsState,
  event: GithubOpsEvent,
): GithubOpsTransitionResult {
  switch (event.type) {
    case "OP_REQUESTED":
      return requestOperation(state, event.op);
    case "OP_SUCCEEDED":
      return operationSucceeded(state, event.op);
    case "OP_FAILED":
      return operationFailed(state, event.op, event.failure);
    case "CONFLICTS":
      return conflictsReceived(state, event);
    case "GIT_STATE":
      return gitStateReceived(state, event);
    case "ABORT_AND_SWITCH_CONFIRMED":
      return abortAndSwitch(state);
    case "BLOCKED_DISMISSED":
      return dismissBlocked(state);
    case "RESOLVE_WITH_AI_STARTED":
      return startResolvingConflicts(state);
    case "CONFLICT_RESOLUTION_STARTED":
      return conflictResolutionStarted(state, event.chatId);
    case "CONFLICT_RESOLUTION_FINISHED":
      return conflictResolutionFinished(state, event.chatId);
    case "CONFLICT_VERIFICATION_FAILED":
      return conflictVerificationFailed(
        state,
        event.verificationAttempt,
        event.message,
      );
    case "RETRY_CONFLICT_VERIFICATION":
      return retryConflictVerification(state);
    case "BANNER_DISMISSED":
      return dismissBanner(state);
    case "RECONCILE_REQUESTED":
      return reconcile(state);
    default:
      return assertNever(event);
  }
}

function requestOperation(
  state: GithubOpsState,
  op: GithubOperation,
): GithubOpsTransitionResult {
  switch (state.type) {
    case "idle":
      return beginOperation(state, op);
    case "running":
      return ignore(state, "op-in-flight");
    case "conflicted":
      if (state.resolution === "resolving" || state.resolution === "checking") {
        return ignore(state, "op-in-flight");
      }
      if (state.resolution === "ready-to-sync") {
        if (
          op.type === "merge-abort" ||
          op.type === "rebase-abort" ||
          op.type === "switch"
        ) {
          return beginOperation(state, op);
        }
        const continuation = continuationOperation(state.origin);
        return continuation && operationsEqual(op, continuation)
          ? beginOperation(
              state,
              op,
              continuation.type === "rebase-continue" ? PUSH_NORMAL : undefined,
            )
          : ignore(state, "blocked-by-conflicts");
      }
      return op.type === "merge-abort" ||
        op.type === "rebase-abort" ||
        op.type === "switch"
        ? beginOperation(state, op)
        : ignore(state, "blocked-by-conflicts");
    case "rebase-paused":
      return op.type === "rebase-abort" ||
        op.type === "rebase-continue" ||
        op.type === "switch" ||
        (op.type === "push" && op.mode === "lease")
        ? beginOperation(state, op)
        : ignore(state, "invalid-in-current-state");
    case "switch-blocked":
      return ignore(state, "invalid-in-current-state");
    default:
      return assertNever(state);
  }
}

function beginOperation(
  state: GithubOpsState,
  op: GithubOperation,
  nextOverride?: GithubOperation,
): GithubOpsTransitionResult {
  const next = nextOverride ?? compositeNext(op);
  const blockedSwitchResume =
    op.type === "switch" ? getBlockedSwitchResume(state) : undefined;
  return {
    kind: "applied",
    state: {
      type: "running",
      op,
      ...(next ? { next } : {}),
      ...(blockedSwitchResume ? { blockedSwitchResume } : {}),
      banner: clearsHistoryBanner(op) ? null : state.banner,
    },
    commands: [{ type: "run-op", op }],
  };
}

function operationSucceeded(
  state: GithubOpsState,
  op: GithubOperation,
): GithubOpsTransitionResult {
  switch (state.type) {
    case "running":
      break;
    case "idle":
    case "conflicted":
    case "rebase-paused":
    case "switch-blocked":
      return ignore(state, "stale-op");
    default:
      return assertNever(state);
  }
  if (!operationsEqual(state.op, op)) {
    return ignore(state, "stale-op");
  }

  const mutationCommands = completionCommands(op);
  if (state.next) {
    return {
      kind: "applied",
      state: {
        type: "running",
        op: state.next,
        banner: successBanner(op),
      },
      commands: [...mutationCommands, { type: "run-op", op: state.next }],
    };
  }

  const banner = successBanner(op);
  return {
    kind: "applied",
    state: { type: "idle", banner },
    commands: mutationCommands,
  };
}

function operationFailed(
  state: GithubOpsState,
  op: GithubOperation,
  failure: GithubOperationFailure,
): GithubOpsTransitionResult {
  switch (state.type) {
    case "running":
      break;
    case "idle":
    case "conflicted":
    case "rebase-paused":
    case "switch-blocked":
      return ignore(state, "stale-op");
    default:
      return assertNever(state);
  }
  if (!operationsEqual(state.op, op)) {
    return ignore(state, "stale-op");
  }

  const failureMessage = truncateGithubOpsErrorMessage(
    state.banner?.kind === "success"
      ? `${state.banner.message} The follow-up operation failed: ${failure.message}`
      : failure.message,
  );
  const banner: GithubOpsBanner = {
    kind: "error",
    ...(failure.code ? { code: failure.code } : {}),
    message: failureMessage,
  };

  if (failure.code === "REBASE_IN_PROGRESS") {
    if (op.type === "switch") {
      return blockedSwitch(
        op.branch,
        "rebase",
        banner,
        state.blockedSwitchResume,
      );
    }
    return changed({ type: "rebase-paused", banner });
  }

  if (failure.code === "MERGE_IN_PROGRESS") {
    if (op.type === "switch") {
      return blockedSwitch(
        op.branch,
        "merge",
        banner,
        state.blockedSwitchResume,
      );
    }
    return awaitConflicts(state, op, banner);
  }

  if (failure.code === "MERGE_CONFLICT") {
    return awaitConflicts(state, op, banner);
  }

  if (!failure.code && isRebaseOperation(op)) {
    return {
      kind: "applied",
      state: { type: "idle", banner },
      commands: [{ type: "probe-git-state" }],
    };
  }

  return {
    kind: "applied",
    state: { type: "idle", banner },
    commands: shouldNotifyOperationFailure(op, failure)
      ? [{ type: "notify", kind: "error", message: failure.message }]
      : [],
  };
}

export function shouldNotifyOperationFailure(
  op: GithubOperation,
  failure: GithubOperationFailure,
): boolean {
  return (
    ["create-branch", "rename-branch", "merge", "delete-branch"].includes(
      op.type,
    ) &&
    failure.code !== "REBASE_IN_PROGRESS" &&
    failure.code !== "MERGE_IN_PROGRESS" &&
    failure.code !== "MERGE_CONFLICT"
  );
}

export function shouldDeferOperationPresentationCleanup(
  op: GithubOperation,
  failure: GithubOperationFailure,
): boolean {
  return (
    shouldNotifyOperationFailure(op, failure) ||
    (!failure.code && isRebaseOperation(op)) ||
    (op.type !== "switch" &&
      (failure.code === "MERGE_IN_PROGRESS" ||
        failure.code === "MERGE_CONFLICT"))
  );
}

function awaitConflicts(
  state: Extract<GithubOpsState, { type: "running" }>,
  op: GithubOperation,
  banner: GithubOpsBanner,
): GithubOpsTransitionResult {
  const samePendingProbe =
    state.awaitingConflicts === true &&
    state.banner?.kind === banner.kind &&
    state.banner.code === banner.code &&
    state.banner.message === banner.message;
  return {
    kind: "applied",
    state: samePendingProbe
      ? state
      : {
          type: "running",
          op,
          banner,
          awaitingConflicts: true,
        },
    commands: [{ type: "probe-conflicts", settleOnError: true }],
  };
}

function conflictsReceived(
  state: GithubOpsState,
  event: Extract<GithubOpsEvent, { type: "CONFLICTS" }>,
): GithubOpsTransitionResult {
  const { files } = event;
  if (
    state.type === "conflicted" &&
    state.resolution === "checking" &&
    state.verificationAttempt !== event.verificationAttempt
  ) {
    return ignore(state, "stale-op");
  }
  switch (state.type) {
    case "running": {
      if (!state.awaitingConflicts) return ignore(state, "no-change");
      if (files.length === 0) {
        return {
          kind: "applied",
          state: { type: "idle", banner: state.banner },
          commands: [],
        };
      }
      return enterConflicted(files, state.op, true);
    }
    case "switch-blocked": {
      const hasConflicts = files.length > 0;
      const resume =
        state.resume?.type === "conflicted"
          ? hasConflicts
            ? sameFiles(state.resume.files, files)
              ? state.resume
              : { ...state.resume, files }
            : state.blockingOp === "rebase"
              ? ({ type: "rebase-paused" } as const)
              : undefined
          : state.resume;
      return state.hasConflicts === hasConflicts && state.resume === resume
        ? ignore(state, "no-change")
        : changed({
            ...state,
            hasConflicts,
            ...(resume ? { resume } : { resume: undefined }),
          });
    }
    case "conflicted":
      if (files.length === 0) {
        if (state.resolution === "ready-to-sync") {
          return ignore(state, "no-change");
        }
        if (state.resolution === "resolving") {
          return ignore(state, "no-change");
        }
        if (state.resolution === "verification-failed") {
          return ignore(state, "no-change");
        }
        const continuation = continuationOperation(state.origin);
        return state.resolution === "checking" && continuation
          ? changed({
              ...state,
              resolution: "ready-to-sync",
              verificationError: undefined,
              banner: null,
            })
          : changed({
              type: "idle",
              banner:
                state.resolution === "checking"
                  ? {
                      kind: "success",
                      message: "Merge conflicts resolved.",
                    }
                  : state.banner,
            });
      }
      if (state.resolution === "resolving") {
        return sameFiles(state.files, files)
          ? ignore(state, "no-change")
          : changed({ ...state, files });
      }
      return sameFiles(state.files, files) && state.resolution === undefined
        ? ignore(state, "no-change")
        : changed({
            ...state,
            files,
            resolution: undefined,
            resolutionChatId: undefined,
            verificationAttempt: undefined,
            verificationError: undefined,
            banner: null,
          });
    case "rebase-paused":
      return files.length > 0
        ? enterConflicted(files, { type: "rebase" }, false)
        : ignore(state, "no-change");
    case "idle":
      return files.length > 0
        ? enterConflicted(files, { type: "reconcile" }, false)
        : ignore(state, "no-change");
    default:
      return assertNever(state);
  }
}

function gitStateReceived(
  state: GithubOpsState,
  event: Extract<GithubOpsEvent, { type: "GIT_STATE" }>,
): GithubOpsTransitionResult {
  if (
    state.type === "conflicted" &&
    state.resolution === "checking" &&
    state.verificationAttempt !== event.verificationAttempt
  ) {
    return ignore(state, "stale-op");
  }
  switch (state.type) {
    case "running":
      return ignore(state, "op-in-flight");
    case "switch-blocked":
      return {
        kind: "applied",
        state,
        commands: [{ type: "probe-conflicts" }],
      };
    case "conflicted": {
      const nextOrigin: ConflictOrigin = event.rebaseInProgress
        ? state.resolution !== undefined || isRebaseConflictOrigin(state.origin)
          ? state.origin
          : { type: "rebase" }
        : state.resolution !== undefined &&
            isResumableRebaseOrigin(state.origin)
          ? PUSH_NORMAL
          : state.resolution === undefined &&
              isRebaseConflictOrigin(state.origin)
            ? { type: "reconcile" }
            : state.origin;
      const nextState =
        nextOrigin === state.origin ? state : { ...state, origin: nextOrigin };
      return {
        kind: "applied",
        state: nextState,
        commands: [
          {
            type: "probe-conflicts",
            verificationAttempt: event.verificationAttempt,
          },
        ],
      };
    }
    case "idle":
    case "rebase-paused": {
      const nextState: GithubOpsState = event.rebaseInProgress
        ? state.type === "rebase-paused"
          ? state
          : {
              type: "rebase-paused",
              banner:
                (state.banner?.kind === "error" ? state.banner : null) ??
                ({
                  kind: "error",
                  code: "REBASE_IN_PROGRESS",
                  message:
                    "A rebase is already in progress. Choose how to proceed.",
                } satisfies GithubOpsBanner),
            }
        : state.type === "rebase-paused"
          ? { type: "idle", banner: state.banner }
          : state;
      return {
        kind: "applied",
        state: nextState,
        commands: [{ type: "probe-conflicts" }],
      };
    }
    default:
      return assertNever(state);
  }
}

function dismissBlocked(state: GithubOpsState): GithubOpsTransitionResult {
  switch (state.type) {
    case "switch-blocked":
      if (state.resume?.type === "conflicted") {
        return changed({
          type: "conflicted",
          files: state.resume.files,
          origin: state.resume.origin,
          banner: state.banner,
        });
      }
      return changed({
        type: state.resume?.type === "rebase-paused" ? "rebase-paused" : "idle",
        banner: state.banner,
      });
    case "idle":
    case "running":
    case "conflicted":
    case "rebase-paused":
      return ignore(state, "invalid-in-current-state");
    default:
      return assertNever(state);
  }
}

function startResolvingConflicts(
  state: GithubOpsState,
): GithubOpsTransitionResult {
  switch (state.type) {
    case "conflicted":
      if (state.resolution !== undefined) {
        return ignore(state, "invalid-in-current-state");
      }
      return {
        kind: "applied",
        state,
        commands: [
          {
            type: "start-conflict-resolution",
            files: state.files,
          },
        ],
      };
    case "idle":
    case "running":
    case "rebase-paused":
    case "switch-blocked":
      return ignore(state, "invalid-in-current-state");
    default:
      return assertNever(state);
  }
}

function conflictResolutionStarted(
  state: GithubOpsState,
  chatId: number,
): GithubOpsTransitionResult {
  switch (state.type) {
    case "conflicted":
      if (state.resolution !== undefined) {
        return ignore(state, "invalid-in-current-state");
      }
      return changed({
        ...state,
        resolution: "resolving",
        resolutionChatId: chatId,
        verificationError: undefined,
        banner: null,
      });
    case "idle":
    case "running":
    case "rebase-paused":
    case "switch-blocked":
      return ignore(state, "invalid-in-current-state");
    default:
      return assertNever(state);
  }
}

function conflictResolutionFinished(
  state: GithubOpsState,
  chatId: number,
): GithubOpsTransitionResult {
  switch (state.type) {
    case "conflicted":
      if (state.resolution !== "resolving") {
        return ignore(state, "invalid-in-current-state");
      }
      if (state.resolutionChatId !== chatId) {
        return ignore(state, "stale-op");
      }
      const verificationAttempt = (state.verificationAttempt ?? 0) + 1;
      return {
        kind: "applied",
        state: {
          ...state,
          resolution: "checking",
          verificationAttempt,
          verificationError: undefined,
        },
        commands: [{ type: "probe-git-state", verificationAttempt }],
      };
    case "idle":
    case "running":
    case "rebase-paused":
    case "switch-blocked":
      return ignore(state, "invalid-in-current-state");
    default:
      return assertNever(state);
  }
}

function conflictVerificationFailed(
  state: GithubOpsState,
  verificationAttempt: number,
  message: string,
): GithubOpsTransitionResult {
  switch (state.type) {
    case "conflicted":
      if (state.resolution !== "checking") {
        return ignore(state, "invalid-in-current-state");
      }
      return state.verificationAttempt === verificationAttempt
        ? changed({
            ...state,
            resolution: "verification-failed",
            verificationError: message,
          })
        : ignore(state, "stale-op");
    case "idle":
    case "running":
    case "rebase-paused":
    case "switch-blocked":
      return ignore(state, "invalid-in-current-state");
    default:
      return assertNever(state);
  }
}

function retryConflictVerification(
  state: GithubOpsState,
): GithubOpsTransitionResult {
  switch (state.type) {
    case "conflicted": {
      if (state.resolution !== "verification-failed") {
        return ignore(state, "invalid-in-current-state");
      }
      const verificationAttempt = (state.verificationAttempt ?? 0) + 1;
      return {
        kind: "applied",
        state: {
          ...state,
          resolution: "checking",
          verificationAttempt,
          verificationError: undefined,
        },
        commands: [{ type: "probe-git-state", verificationAttempt }],
      };
    }
    case "idle":
    case "running":
    case "rebase-paused":
    case "switch-blocked":
      return ignore(state, "invalid-in-current-state");
    default:
      return assertNever(state);
  }
}

function dismissBanner(state: GithubOpsState): GithubOpsTransitionResult {
  switch (state.type) {
    case "idle":
    case "running":
    case "conflicted":
    case "rebase-paused":
    case "switch-blocked":
      return state.banner === null
        ? ignore(state, "no-change")
        : changed({ ...state, banner: null });
    default:
      return assertNever(state);
  }
}

function reconcile(state: GithubOpsState): GithubOpsTransitionResult {
  switch (state.type) {
    case "idle":
      return {
        kind: "applied",
        state,
        commands: [{ type: "probe-git-state" }],
      };
    case "conflicted":
      if (state.resolution === "verification-failed") {
        return ignore(state, "no-change");
      }
      return {
        kind: "applied",
        state,
        commands: [
          {
            type: "probe-git-state",
            verificationAttempt:
              state.resolution === "checking"
                ? state.verificationAttempt
                : undefined,
          },
        ],
      };
    case "rebase-paused":
    case "switch-blocked":
      return {
        kind: "applied",
        state,
        commands: [{ type: "probe-git-state" }],
      };
    case "running":
      return ignore(state, "op-in-flight");
    default:
      return assertNever(state);
  }
}

function abortAndSwitch(state: GithubOpsState): GithubOpsTransitionResult {
  switch (state.type) {
    case "switch-blocked":
      break;
    case "idle":
    case "running":
    case "conflicted":
    case "rebase-paused":
      return ignore(state, "invalid-in-current-state");
    default:
      return assertNever(state);
  }
  const op: GithubOperation =
    state.blockingOp === "rebase"
      ? { type: "rebase-abort" }
      : { type: "merge-abort" };
  const next: GithubOperation = { type: "switch", branch: state.target };
  return {
    kind: "applied",
    state: { type: "running", op, next, banner: null },
    commands: [{ type: "run-op", op }],
  };
}

function enterConflicted(
  files: readonly string[],
  origin: ConflictOrigin,
  notify: boolean,
): GithubOpsTransitionResult {
  return {
    kind: "applied",
    state: {
      type: "conflicted",
      files,
      origin,
      banner: null,
    },
    commands: notify
      ? [
          {
            type: "notify",
            kind: "info",
            message: "Sync paused. Resolve merge conflicts to continue.",
          },
        ]
      : [],
  };
}

export function continuationOperation(
  origin: ConflictOrigin,
): GithubOperation | undefined {
  switch (origin.type) {
    case "push":
      return origin;
    case "rebase":
    case "rebase-continue":
      return { type: "rebase-continue" };
    case "reconcile":
    case "pull":
    case "fetch":
    case "rebase-abort":
    case "merge-abort":
    case "merge":
    case "switch":
    case "create-branch":
    case "delete-branch":
    case "rename-branch":
    case "disconnect":
    case "connect-repo":
      return undefined;
    default:
      return assertNever(origin);
  }
}

function isRebaseOperation(op: GithubOperation): boolean {
  return (
    op.type === "rebase" ||
    op.type === "rebase-continue" ||
    op.type === "rebase-abort"
  );
}

function isRebaseConflictOrigin(origin: ConflictOrigin): boolean {
  return origin.type !== "reconcile" && isRebaseOperation(origin);
}

function isResumableRebaseOrigin(origin: ConflictOrigin): boolean {
  return origin.type === "rebase" || origin.type === "rebase-continue";
}

function blockedSwitch(
  target: string,
  blockingOp: BlockingOperation,
  banner: GithubOpsBanner,
  resume?: BlockedSwitchResume,
): GithubOpsTransitionResult {
  return {
    kind: "applied",
    state: {
      type: "switch-blocked",
      target,
      blockingOp,
      // Pessimistic until the probe succeeds: a probe failure must not make
      // destructive abort-and-switch look conflict-free.
      hasConflicts: true,
      ...(resume ? { resume } : {}),
      banner,
    },
    commands: [{ type: "probe-conflicts" }],
  };
}

function getBlockedSwitchResume(
  state: GithubOpsState,
): BlockedSwitchResume | undefined {
  switch (state.type) {
    case "conflicted":
      return {
        type: "conflicted",
        files: state.files,
        origin: state.origin,
      };
    case "rebase-paused":
      return { type: "rebase-paused" };
    case "idle":
    case "running":
    case "switch-blocked":
      return undefined;
    default:
      return assertNever(state);
  }
}

function compositeNext(op: GithubOperation): GithubOperation | undefined {
  switch (op.type) {
    case "rebase":
      return PUSH_NORMAL;
    case "create-branch":
      return op.thenSwitch ? { type: "switch", branch: op.name } : undefined;
    case "connect-repo":
      return op.thenAutoPush ? PUSH_NORMAL : undefined;
    case "push":
    case "pull":
    case "fetch":
    case "rebase-continue":
    case "rebase-abort":
    case "merge-abort":
    case "merge":
    case "switch":
    case "delete-branch":
    case "rename-branch":
    case "disconnect":
      return undefined;
    default:
      return assertNever(op);
  }
}

function completionCommands(op: GithubOperation): GithubOpsCommand[] {
  switch (op.type) {
    case "push":
    case "pull":
    case "fetch":
    case "rebase":
    case "rebase-continue":
    case "rebase-abort":
    case "merge-abort":
    case "merge":
    case "switch":
    case "create-branch":
    case "delete-branch":
    case "rename-branch":
      return [{ type: "invalidate-branches" }, { type: "refresh-app" }];
    case "disconnect":
    case "connect-repo":
      return [{ type: "refresh-app" }, { type: "invalidate-branches" }];
    default:
      return assertNever(op);
  }
}

function successBanner(op: GithubOperation): GithubOpsBanner | null {
  const banner = successBannerContent(op);
  return banner ? { ...banner, completedOperation: op.type } : null;
}

function successBannerContent(op: GithubOperation): GithubOpsBanner | null {
  switch (op.type) {
    case "push":
      return {
        kind: "success",
        message: "Successfully pushed to GitHub!",
      };
    case "pull":
      return { kind: "success", message: "Pulled latest changes from remote" };
    case "fetch":
      return { kind: "success", message: "Fetched latest remote branches" };
    case "rebase":
      return {
        kind: "success",
        message: "Rebase completed successfully.",
      };
    case "rebase-continue":
      return {
        kind: "success",
        message: "Rebase continued. You can sync when ready.",
      };
    case "rebase-abort":
      return {
        kind: "success",
        message: "Rebase aborted. You can try syncing again.",
      };
    case "merge-abort":
      return { kind: "success", message: "Sync cancelled" };
    case "merge":
      return { kind: "success", message: `Merged '${op.branch}'` };
    case "switch":
      return {
        kind: "success",
        message: `Switched to branch '${op.branch}'`,
      };
    case "create-branch":
      return {
        kind: "success",
        message: `Branch '${op.name}' created`,
      };
    case "delete-branch":
      return {
        kind: "success",
        message: `Branch '${op.branch}' deleted`,
      };
    case "rename-branch":
      return {
        kind: "success",
        message: `Renamed '${op.oldBranch}' to '${op.newBranch}'`,
      };
    case "connect-repo":
      return {
        kind: "success",
        message:
          op.mode === "create"
            ? "Repository created and linked successfully."
            : "Connected to repository successfully.",
      };
    case "disconnect":
      return null;
    default:
      return assertNever(op);
  }
}

function clearsHistoryBanner(op: GithubOperation): boolean {
  return op.type !== "fetch";
}

export function operationsEqual(
  left: GithubOperation,
  right: GithubOperation,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameFiles(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((file, index) => file === right[index])
  );
}

function changed(state: GithubOpsState): GithubOpsTransitionResult {
  return { kind: "applied", state, commands: [] };
}

function ignore(
  state: GithubOpsState,
  reason: GithubOpsIgnoreReason,
): GithubOpsTransitionResult {
  return ignoreTransition(state, reason);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected github_ops value: ${JSON.stringify(value)}`);
}
