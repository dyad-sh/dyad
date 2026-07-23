import type { GithubOperation, GithubOpsBanner, GithubOpsState } from "./state";

export interface GithubOpsProjection {
  readonly state: GithubOpsState;
  readonly banner: GithubOpsBanner | null;
  readonly isOperationInFlight: boolean;
  readonly isSyncing: boolean;
  readonly conflicts: readonly string[];
  readonly rebaseInProgress: boolean;
  readonly rebaseAction: "abort" | "continue" | "safe-push" | null;
  readonly showForcePush: boolean;
  readonly showRebaseAndSync: boolean;
  readonly showRebaseRecoveryOptions: boolean;
  readonly abortOperation: "merge-abort" | "rebase-abort";
  readonly runningOperation: GithubOperation | null;
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
    isSyncing:
      state.type === "running" &&
      (state.op.type === "push" || state.op.type === "rebase"),
    conflicts: state.type === "conflicted" ? state.files : EMPTY_CONFLICTS,
    rebaseInProgress:
      state.type === "rebase-paused" ||
      (state.type === "switch-blocked" && state.blockingOp === "rebase") ||
      (state.type === "conflicted" && state.origin.type === "rebase"),
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
      (state.type === "conflicted" && state.origin.type === "rebase")
        ? "rebase-abort"
        : "merge-abort",
    runningOperation,
  };
  projectionCache.set(state, projection);
  return projection;
}
