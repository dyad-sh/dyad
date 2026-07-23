import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useCurrentBranch } from "@/hooks/useCurrentBranch";
import type { PreviewState } from "@/version_preview/state";

/**
 * The branch a version's edits should be written to: while a historical version
 * is checked out HEAD is detached, so the current branch is `<no-branch>` and we
 * must fall back to the session's captured origin branch (the branch that was
 * live before the checkout). When no version is checked out (e.g. a read-only
 * diff opened from the modified-files card) HEAD is still attached, so the
 * origin branch is null and the current branch is the writable one.
 */
function originBranchForState(state: PreviewState): string | null {
  switch (state.type) {
    case "viewing-diff":
    case "browsing":
    case "resolving-origin":
    case "checking-out":
    case "previewing":
    case "restoring":
    case "returning":
    case "recovery-required":
      return state.session.originBranch;
    default:
      // "closed" and "switching-branch" carry no session/origin branch.
      return null;
  }
}

export interface WritableVersionTip {
  /** The branch a version-diff edit is written to, or null if unresolved. */
  writableBranch: string | null;
  /** The tip commit of `writableBranch`, or null if unresolved. */
  writableTipOid: string | null;
}

/**
 * Resolves the writable branch and its tip commit for the app's active version
 * preview. Editing a version diff is only permitted when the version being
 * shown *is* this tip (see CodeView), and the tip doubles as the optimistic
 * concurrency token passed to `editAppFile`.
 */
export function useWritableVersionTip({
  appId,
  previewState,
  enabled,
}: {
  appId: number | null;
  previewState: PreviewState;
  enabled: boolean;
}): WritableVersionTip {
  const { branchInfo } = useCurrentBranch(enabled ? appId : null);
  const originBranch = originBranchForState(previewState);
  const currentBranch =
    branchInfo?.branch && branchInfo.branch !== "<no-branch>"
      ? branchInfo.branch
      : null;
  const writableBranch = originBranch ?? currentBranch;

  const { data } = useQuery({
    queryKey: queryKeys.branches.tip({ appId, branch: writableBranch }),
    queryFn: () =>
      ipc.version.getBranchTip({ appId: appId!, branch: writableBranch! }),
    enabled: enabled && appId != null && writableBranch != null,
  });

  return {
    writableBranch,
    writableTipOid: data?.oid ?? null,
  };
}
