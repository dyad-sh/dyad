import type { IpcMainInvokeEvent } from "electron";
import type { GithubOperation } from "@/github_ops/state";
import {
  handleAbortRebase,
  handleConnectToExistingRepo,
  handleContinueRebase,
  handleCreateRepo,
  handleDisconnectGithubRepo,
  handleGetGitState,
  handleGetMergeConflicts,
  handlePushToGithub,
  handleRebaseFromGithub,
} from "../handlers/github_handlers";
import {
  handleAbortMerge,
  handleCreateBranch,
  handleDeleteBranch,
  handleFetchFromGithub,
  handleMergeBranch,
  handlePullFromGithub,
  handleRenameBranch,
  handleSwitchBranch,
} from "../handlers/git_branch_handlers";
import { withLock } from "../utils/lock_utils";

// The extracted handler cores do not inspect the Electron event. Keeping the
// placeholder confined to this compatibility seam lets the hosted actor call
// main Git services without any renderer IPC round trip.
const MAIN_SERVICE_EVENT = undefined as unknown as IpcMainInvokeEvent;

export class GithubOpsService {
  run(appId: number, op: GithubOperation): Promise<void> {
    return withLock(appId, () => this.runUnlocked(appId, op));
  }

  private runUnlocked(appId: number, op: GithubOperation): Promise<void> {
    switch (op.type) {
      case "push":
        return handlePushToGithub(MAIN_SERVICE_EVENT, {
          appId,
          force: op.mode === "force",
          forceWithLease: op.mode === "lease",
        });
      case "pull":
        return handlePullFromGithub(MAIN_SERVICE_EVENT, { appId });
      case "fetch":
        return handleFetchFromGithub(MAIN_SERVICE_EVENT, { appId });
      case "rebase":
        return handleRebaseFromGithub(MAIN_SERVICE_EVENT, { appId });
      case "rebase-continue":
        return handleContinueRebase(MAIN_SERVICE_EVENT, { appId });
      case "rebase-abort":
        return handleAbortRebase(MAIN_SERVICE_EVENT, { appId });
      case "merge-abort":
        return handleAbortMerge(MAIN_SERVICE_EVENT, { appId });
      case "merge":
        return handleMergeBranch(MAIN_SERVICE_EVENT, {
          appId,
          branch: op.branch,
        });
      case "switch":
        return handleSwitchBranch(MAIN_SERVICE_EVENT, {
          appId,
          branch: op.branch,
        });
      case "create-branch":
        return handleCreateBranch(MAIN_SERVICE_EVENT, {
          appId,
          branch: op.name,
          from: op.from,
        });
      case "delete-branch":
        return handleDeleteBranch(MAIN_SERVICE_EVENT, {
          appId,
          branch: op.branch,
        });
      case "rename-branch":
        return handleRenameBranch(MAIN_SERVICE_EVENT, {
          appId,
          oldBranch: op.oldBranch,
          newBranch: op.newBranch,
        });
      case "disconnect":
        return handleDisconnectGithubRepo(MAIN_SERVICE_EVENT, { appId });
      case "connect-repo":
        return op.mode === "create"
          ? handleCreateRepo(MAIN_SERVICE_EVENT, {
              appId,
              org: op.org,
              repo: op.repo,
              branch: op.branch,
            })
          : handleConnectToExistingRepo(MAIN_SERVICE_EVENT, {
              appId,
              owner: op.owner,
              repo: op.repo,
              branch: op.branch,
            });
    }
  }

  getGitState(appId: number) {
    return handleGetGitState(MAIN_SERVICE_EVENT, { appId });
  }

  getConflicts(appId: number) {
    return handleGetMergeConflicts(MAIN_SERVICE_EVENT, { appId });
  }
}

export const githubOpsService = new GithubOpsService();
