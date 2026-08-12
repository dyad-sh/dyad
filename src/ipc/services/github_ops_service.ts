import type { IpcMainInvokeEvent } from "electron";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
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
import {
  appOperationCoordinator,
  readAppResource,
} from "./app_operation_coordinator";

// The extracted handler cores do not inspect the Electron event. Keeping the
// placeholder confined to this compatibility seam lets the hosted actor call
// main Git services without any renderer IPC round trip.
const MAIN_SERVICE_EVENT = undefined as unknown as IpcMainInvokeEvent;

export function getGithubOperationResources(op: GithubOperation) {
  if (op.type === "disconnect") {
    return ["metadata"] as const;
  }
  if (op.type === "connect-repo") {
    return [readAppResource("app-path"), "metadata", "repository"] as const;
  }
  return [readAppResource("app-path"), "repository"] as const;
}

/**
 * The action to name when a recording refuses this operation, in the
 * imperative — or undefined for one that never queues behind a session.
 *
 * Everything but `disconnect` takes `repository`, which a recording holds as a
 * write claim for its whole life, so without this the GitHub actor sits in its
 * running state until the session ends or hits the 30-minute cap with nothing
 * on screen saying why. `disconnect` takes only `metadata`, which no session
 * claims.
 */
export function getGithubRecordingRefusal(
  op: GithubOperation,
): string | undefined {
  switch (op.type) {
    case "disconnect":
      return undefined;
    case "push":
      return "push to GitHub";
    case "pull":
      return "pull from GitHub";
    case "fetch":
      return "fetch from GitHub";
    case "rebase":
      return "rebase";
    case "rebase-continue":
      return "continue the rebase";
    case "rebase-abort":
      return "abort the rebase";
    case "merge":
      return "merge a branch";
    case "merge-abort":
      return "abort the merge";
    case "switch":
      return "switch branches";
    case "create-branch":
      return "create a branch";
    case "delete-branch":
      return "delete a branch";
    case "rename-branch":
      return "rename a branch";
    case "connect-repo":
      return "connect a GitHub repository";
  }
}

export class GithubOpsService {
  private readonly deletionFences = new Map<number, number>();
  private readonly pendingByApp = new Map<number, Set<Promise<unknown>>>();
  private resetFenceCount = 0;

  run(appId: number, op: GithubOperation): Promise<void> {
    // Check before queueing so deletion never waits on a command that is
    // itself queued behind the deletion's per-app lock.
    try {
      this.assertAcceptingOperations(appId);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.track(
      appId,
      appOperationCoordinator.run(
        {
          appId,
          operation: `github:${op.type}`,
          resources: getGithubOperationResources(op),
          refuseWhenRecording: getGithubRecordingRefusal(op),
        },
        () => {
          this.assertAcceptingOperations(appId);
          return this.runUnlocked(appId, op);
        },
      ),
    );
  }

  beginAppDeletion(appId: number): void {
    this.deletionFences.set(appId, (this.deletionFences.get(appId) ?? 0) + 1);
  }

  endAppDeletion(appId: number): void {
    const remaining = (this.deletionFences.get(appId) ?? 1) - 1;
    if (remaining > 0) this.deletionFences.set(appId, remaining);
    else this.deletionFences.delete(appId);
  }

  beginReset(): void {
    this.resetFenceCount += 1;
  }

  endReset(): void {
    this.resetFenceCount = Math.max(0, this.resetFenceCount - 1);
  }

  assertAcceptingOperations(appId: number): void {
    if (this.resetFenceCount > 0 || this.deletionFences.has(appId)) {
      throw new DyadError(
        "The app is being deleted",
        DyadErrorKind.Precondition,
      );
    }
  }

  async settle(appId: number): Promise<void> {
    const pending = this.pendingByApp.get(appId);
    if (!pending?.size) return;
    await Promise.allSettled(pending);
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
    try {
      this.assertAcceptingOperations(appId);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.track(appId, handleGetGitState(MAIN_SERVICE_EVENT, { appId }));
  }

  getConflicts(appId: number) {
    try {
      this.assertAcceptingOperations(appId);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.track(
      appId,
      handleGetMergeConflicts(MAIN_SERVICE_EVENT, { appId }),
    );
  }

  private track<Result>(
    appId: number,
    promise: Promise<Result>,
  ): Promise<Result> {
    let pending = this.pendingByApp.get(appId);
    if (!pending) {
      pending = new Set();
      this.pendingByApp.set(appId, pending);
    }
    pending.add(promise);
    const cleanup = () => {
      pending?.delete(promise);
      if (pending?.size === 0) this.pendingByApp.delete(appId);
    };
    void promise.then(cleanup, cleanup);
    return promise;
  }
}

export const githubOpsService = new GithubOpsService();
