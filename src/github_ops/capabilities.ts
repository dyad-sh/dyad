import type { GithubOpsState } from "./state";

export interface GithubOpsCapabilities {
  readonly canSync: boolean;
  readonly canDisconnect: boolean;
  readonly canAbortRebase: boolean;
  readonly canContinueRebase: boolean;
  readonly canSafeForcePush: boolean;
  readonly canForcePush: boolean;
  readonly canRebaseAndSync: boolean;
  readonly canResolveConflicts: boolean;
  readonly canCancelSync: boolean;
  readonly canMutateBranches: boolean;
  readonly canSwitchBranches: boolean;
  readonly canConfirmBlockedSwitch: boolean;
  readonly canDismissBlockedSwitch: boolean;
  readonly canConnectRepository: boolean;
}

/** Pure domain policy for interactive controls backed by github_ops events. */
export function selectGithubOpsCapabilities(
  state: GithubOpsState,
): GithubOpsCapabilities {
  const isIdle = state.type === "idle";
  return {
    canSync: isIdle,
    canDisconnect: isIdle,
    canAbortRebase: state.type === "rebase-paused",
    canContinueRebase: state.type === "rebase-paused",
    canSafeForcePush: state.type === "rebase-paused",
    canForcePush:
      isIdle &&
      state.banner?.kind === "error" &&
      state.banner.code === "NON_FAST_FORWARD",
    canRebaseAndSync:
      isIdle &&
      state.banner?.kind === "error" &&
      state.banner.code === "DIVERGENT_BRANCHES",
    canResolveConflicts: state.type === "conflicted",
    canCancelSync: state.type === "conflicted",
    canMutateBranches: isIdle,
    canSwitchBranches:
      isIdle || state.type === "conflicted" || state.type === "rebase-paused",
    canConfirmBlockedSwitch: state.type === "switch-blocked",
    canDismissBlockedSwitch: state.type === "switch-blocked",
    canConnectRepository: isIdle,
  };
}
