import type { GithubOperation, GithubOpsBanner, GithubOpsState } from "./state";

export interface GithubOpsProjection {
  readonly state: GithubOpsState;
  readonly banner: GithubOpsBanner | null;
  readonly isOperationInFlight: boolean;
  readonly canRequestSync: boolean;
  readonly isSyncing: boolean;
  readonly conflicts: readonly string[];
  readonly rebaseInProgress: boolean;
  readonly rebaseAction: "abort" | "continue" | "safe-push" | null;
  readonly showForcePush: boolean;
  readonly showRebaseAndSync: boolean;
  readonly showRebaseRecoveryOptions: boolean;
  readonly abortOperation: "merge-abort" | "rebase-abort";
  readonly runningOperation: GithubOperation | null;
  readonly isCreatingBranch: boolean;
  readonly isSwitchingBranch: boolean;
  readonly isDeletingBranch: boolean;
  readonly isRenamingBranch: boolean;
  readonly isMergingBranch: boolean;
  readonly isPulling: boolean;
  readonly isCancellingSync: boolean;
  readonly canRequestBranchMutation: boolean;
  readonly canRequestBranchSwitch: boolean;
  readonly switchBlocked: {
    readonly target: string;
    readonly blockingOp: "merge" | "rebase";
    readonly hasConflicts: boolean;
  } | null;
}

const EMPTY_CONFLICTS: readonly string[] = [];
const projectionCache = new WeakMap<GithubOpsState, GithubOpsProjection>();

/** Reference-stable view consumed by GitHub UI projections. */
export function projectGithubOps(state: GithubOpsState): GithubOpsProjection {
  const cached = projectionCache.get(state);
  if (cached) return cached;

  const runningOperation = state.type === "running" ? state.op : null;
  const projection: GithubOpsProjection = {
    state,
    banner: state.banner,
    isOperationInFlight: state.type === "running",
    canRequestSync: state.type === "idle",
    isSyncing:
      state.type === "running" &&
      (state.op.type === "push" || state.op.type === "rebase"),
    conflicts: state.type === "conflicted" ? state.files : EMPTY_CONFLICTS,
    rebaseInProgress:
      state.type === "rebase-paused" ||
      (state.type === "switch-blocked" && state.blockingOp === "rebase") ||
      (state.type === "conflicted" && isRebaseFamily(state.origin.type)),
    rebaseAction:
      state.type !== "running"
        ? null
        : state.op.type === "rebase-abort"
          ? "abort"
          : state.op.type === "rebase-continue"
            ? "continue"
            : state.op.type === "push" && state.op.mode === "lease"
              ? "safe-push"
              : null,
    showForcePush:
      state.banner?.kind === "error" &&
      state.banner.code === "NON_FAST_FORWARD",
    showRebaseAndSync:
      state.banner?.kind === "error" &&
      state.banner.code === "DIVERGENT_BRANCHES",
    showRebaseRecoveryOptions: state.type === "rebase-paused",
    abortOperation:
      state.type === "rebase-paused" ||
      (state.type === "conflicted" && isRebaseFamily(state.origin.type))
        ? "rebase-abort"
        : "merge-abort",
    runningOperation,
    isCreatingBranch: runningOperation?.type === "create-branch",
    isSwitchingBranch: runningOperation?.type === "switch",
    isDeletingBranch: runningOperation?.type === "delete-branch",
    isRenamingBranch: runningOperation?.type === "rename-branch",
    isMergingBranch: runningOperation?.type === "merge",
    isPulling: runningOperation?.type === "pull",
    isCancellingSync:
      runningOperation?.type === "merge-abort" ||
      runningOperation?.type === "rebase-abort",
    canRequestBranchMutation: state.type === "idle",
    canRequestBranchSwitch:
      state.type === "idle" ||
      state.type === "conflicted" ||
      state.type === "rebase-paused",
    switchBlocked:
      state.type === "switch-blocked"
        ? {
            target: state.target,
            blockingOp: state.blockingOp,
            hasConflicts: state.hasConflicts,
          }
        : null,
  };
  projectionCache.set(state, projection);
  return projection;
}

function isRebaseFamily(type: GithubOperation["type"] | "reconcile"): boolean {
  return (
    type === "rebase" || type === "rebase-continue" || type === "rebase-abort"
  );
}
