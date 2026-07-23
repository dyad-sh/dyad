import { ignore as ignoreTransition } from "@/state_machines/types";
import type {
  BlockingOperation,
  GithubOperation,
  GithubOperationFailure,
  GithubOpsBanner,
  GithubOpsCommand,
  GithubOpsEvent,
  GithubOpsIgnoreReason,
  GithubOpsState,
  GithubOpsTransitionResult,
} from "./state";

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
      return conflictsReceived(state, event.files);
    case "GIT_STATE":
      return gitStateReceived(state, event);
    case "ABORT_AND_SWITCH_CONFIRMED":
      return abortAndSwitch(state);
    case "BLOCKED_DISMISSED":
      return state.type === "switch-blocked"
        ? changed({ type: "idle", banner: state.banner })
        : ignore(state, "invalid-in-current-state");
    case "RESOLVE_WITH_AI_STARTED":
      return state.type === "conflicted"
        ? {
            state: { type: "idle", banner: null },
            commands: [
              {
                type: "start-conflict-resolution",
                files: state.files,
              },
            ],
          }
        : ignore(state, "invalid-in-current-state");
    case "BANNER_DISMISSED":
      return state.banner === null
        ? ignore(state, "no-change")
        : changed({ ...state, banner: null });
    case "RECONCILE_REQUESTED":
      return {
        state,
        commands: [{ type: "probe-git-state" }, { type: "probe-conflicts" }],
      };
    default:
      return assertNever(event);
  }
}

function requestOperation(
  state: GithubOpsState,
  op: GithubOperation,
): GithubOpsTransitionResult {
  if (state.type === "running") return ignore(state, "op-in-flight");

  if (
    state.type === "conflicted" &&
    op.type !== "merge-abort" &&
    op.type !== "rebase-abort"
  ) {
    return ignore(state, "blocked-by-conflicts");
  }

  if (
    state.type === "rebase-paused" &&
    op.type !== "rebase-abort" &&
    op.type !== "rebase-continue" &&
    !(op.type === "push" && op.mode === "lease")
  ) {
    return ignore(state, "invalid-in-current-state");
  }

  if (state.type === "switch-blocked") {
    return ignore(state, "invalid-in-current-state");
  }

  const next = compositeNext(op);
  return {
    state: {
      type: "running",
      op,
      ...(next ? { next } : {}),
      banner: clearsHistoryBanner(op) ? null : state.banner,
    },
    commands: [{ type: "run-op", op }],
  };
}

function operationSucceeded(
  state: GithubOpsState,
  op: GithubOperation,
): GithubOpsTransitionResult {
  if (state.type !== "running" || !operationsEqual(state.op, op)) {
    return ignore(state, "stale-op");
  }

  const mutationCommands = completionCommands(op);
  if (state.next) {
    return {
      state: {
        type: "running",
        op: state.next,
        banner: null,
      },
      commands: [...mutationCommands, { type: "run-op", op: state.next }],
    };
  }

  const banner = successBanner(op);
  return {
    state: { type: "idle", banner },
    commands: [
      ...mutationCommands,
      ...(banner
        ? [
            {
              type: "notify" as const,
              kind: banner.kind,
              message: banner.message,
            },
          ]
        : []),
    ],
  };
}

function operationFailed(
  state: GithubOpsState,
  op: GithubOperation,
  failure: GithubOperationFailure,
): GithubOpsTransitionResult {
  if (state.type !== "running" || !operationsEqual(state.op, op)) {
    return ignore(state, "stale-op");
  }

  const banner: GithubOpsBanner = {
    kind: "error",
    ...(failure.code ? { code: failure.code } : {}),
    message: failure.message,
  };

  if (failure.code === "REBASE_IN_PROGRESS") {
    if (op.type === "switch") {
      return blockedSwitch(op.branch, "rebase", banner);
    }
    return changed({ type: "rebase-paused", banner });
  }

  if (failure.code === "MERGE_IN_PROGRESS") {
    if (op.type === "switch") {
      return blockedSwitch(op.branch, "merge", banner);
    }
    return awaitConflicts(state, op, banner);
  }

  if (failure.code === "MERGE_CONFLICT") {
    return awaitConflicts(state, op, banner);
  }

  return {
    state: { type: "idle", banner },
    commands: [{ type: "notify", kind: "error", message: failure.message }],
  };
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
    state: samePendingProbe
      ? state
      : {
          type: "running",
          op,
          banner,
          awaitingConflicts: true,
        },
    commands: [{ type: "probe-conflicts" }],
  };
}

function conflictsReceived(
  state: GithubOpsState,
  files: readonly string[],
): GithubOpsTransitionResult {
  if (state.type === "running" && state.awaitingConflicts) {
    if (files.length === 0) {
      return {
        state: { type: "idle", banner: state.banner },
        commands: state.banner
          ? [
              {
                type: "notify",
                kind: "error",
                message: state.banner.message,
              },
            ]
          : [],
      };
    }
    const message =
      "Merge conflicts detected. Use the buttons below to resolve them.";
    return {
      state: {
        type: "conflicted",
        files,
        origin: state.op,
        banner: {
          kind: "error",
          code: "MERGE_CONFLICT",
          message,
        },
      },
      commands: [
        {
          type: "notify",
          kind: "error",
          message: "Merge conflicts detected while syncing to GitHub.",
        },
      ],
    };
  }

  if (state.type === "switch-blocked") {
    if (state.hasConflicts === files.length > 0) {
      return ignore(state, "no-change");
    }
    return changed({ ...state, hasConflicts: files.length > 0 });
  }

  if (state.type === "conflicted") {
    if (files.length === 0) {
      return changed({ type: "idle", banner: state.banner });
    }
    if (sameFiles(state.files, files)) return ignore(state, "no-change");
    return changed({ ...state, files });
  }

  if (files.length > 0 && state.type !== "running") {
    return changed({
      type: "conflicted",
      files,
      origin: { type: "reconcile" },
      banner: {
        kind: "error",
        code: "MERGE_CONFLICT",
        message:
          "Merge conflicts detected. Use the buttons below to resolve them.",
      },
    });
  }

  return ignore(state, "no-change");
}

function gitStateReceived(
  state: GithubOpsState,
  event: Extract<GithubOpsEvent, { type: "GIT_STATE" }>,
): GithubOpsTransitionResult {
  if (state.type === "running") {
    return ignore(state, "op-in-flight");
  }
  if (state.type === "switch-blocked" || state.type === "conflicted") {
    return ignore(state, "invalid-in-current-state");
  }
  if (event.rebaseInProgress) {
    return state.type === "rebase-paused"
      ? ignore(state, "no-change")
      : changed({
          type: "rebase-paused",
          banner: {
            kind: "error",
            code: "REBASE_IN_PROGRESS",
            message: "A rebase is already in progress. Choose how to proceed.",
          },
        });
  }
  if (event.mergeInProgress) {
    return {
      state,
      commands: [{ type: "probe-conflicts" }],
    };
  }
  return state.type === "rebase-paused"
    ? changed({ type: "idle", banner: state.banner })
    : ignore(state, "no-change");
}

function abortAndSwitch(state: GithubOpsState): GithubOpsTransitionResult {
  if (state.type !== "switch-blocked") {
    return ignore(state, "invalid-in-current-state");
  }
  const op: GithubOperation =
    state.blockingOp === "rebase"
      ? { type: "rebase-abort" }
      : { type: "merge-abort" };
  const next: GithubOperation = { type: "switch", branch: state.target };
  return {
    state: { type: "running", op, next, banner: null },
    commands: [{ type: "run-op", op }],
  };
}

function blockedSwitch(
  target: string,
  blockingOp: BlockingOperation,
  banner: GithubOpsBanner,
): GithubOpsTransitionResult {
  return {
    state: {
      type: "switch-blocked",
      target,
      blockingOp,
      hasConflicts: false,
      banner,
    },
    commands: [{ type: "probe-conflicts" }],
  };
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
        message: "Rebase and push completed successfully.",
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
    case "disconnect":
    case "connect-repo":
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
  return { state, commands: [] };
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
