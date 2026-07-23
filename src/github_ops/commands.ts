import type { QueryClient } from "@tanstack/react-query";
import { isDyadError } from "@/errors/dyad_error";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showInfo, showSuccess } from "@/lib/toast";
import type {
  GithubOperation,
  GithubOpsCommand,
  GithubOpsEvent,
} from "./state";

export type ConflictResolutionRunner = (
  files: readonly string[],
) => void | Promise<void>;

/**
 * Side-effect adapter for github_ops.
 *
 * The injected conflict-resolution callback is the composition boundary to
 * the existing `useResolveMergeConflictsWithAI` submission path. This module
 * intentionally has no chat_stream dependency.
 */
export class GithubOpsCommandRunner {
  private readonly conflictResolutionRunners = new Map<
    number,
    ConflictResolutionRunner
  >();
  private readonly gitStateProbeGenerations = new Map<number, number>();
  private readonly conflictProbeGenerations = new Map<number, number>();

  constructor(private readonly queryClient: QueryClient) {}

  registerConflictResolutionRunner(
    appId: number,
    runner: ConflictResolutionRunner,
  ): () => void {
    this.conflictResolutionRunners.set(appId, runner);
    return () => {
      if (this.conflictResolutionRunners.get(appId) === runner) {
        this.conflictResolutionRunners.delete(appId);
      }
    };
  }

  run(
    appId: number,
    command: GithubOpsCommand,
    emit: (event: GithubOpsEvent) => void,
  ): void {
    switch (command.type) {
      case "run-op":
        this.invalidateProbes(appId);
        void runOperation(appId, command.op).then(
          () => emit({ type: "OP_SUCCEEDED", op: command.op }),
          (error) =>
            emit({
              type: "OP_FAILED",
              op: command.op,
              failure: operationFailure(error),
            }),
        );
        return;
      case "probe-git-state":
        {
          const generation = this.nextGeneration(
            this.gitStateProbeGenerations,
            appId,
          );
          void ipc.github.getGitState({ appId }).then(
            (state) => {
              if (
                this.isCurrentGeneration(
                  this.gitStateProbeGenerations,
                  appId,
                  generation,
                )
              ) {
                emit({ type: "GIT_STATE", ...state });
              }
            },
            (error) => {
              if (
                this.isCurrentGeneration(
                  this.gitStateProbeGenerations,
                  appId,
                  generation,
                )
              ) {
                showError(errorMessage(error, "Failed to inspect Git state"));
              }
            },
          );
        }
        return;
      case "probe-conflicts":
        {
          const generation = this.nextGeneration(
            this.conflictProbeGenerations,
            appId,
          );
          void ipc.github.getConflicts({ appId }).then(
            (files) => {
              if (
                this.isCurrentGeneration(
                  this.conflictProbeGenerations,
                  appId,
                  generation,
                )
              ) {
                emit({ type: "CONFLICTS", files });
              }
            },
            (error) => {
              if (
                !this.isCurrentGeneration(
                  this.conflictProbeGenerations,
                  appId,
                  generation,
                )
              ) {
                return;
              }
              showError(errorMessage(error, "Failed to inspect Git conflicts"));
              // Only the probe attached to a coded operation failure must
              // settle the machine. Reconcile failures preserve confirmed
              // conflict state instead of fabricating an empty result.
              if (command.settleOnError) {
                emit({ type: "CONFLICTS", files: [] });
              }
            },
          );
        }
        return;
      case "invalidate-branches":
        void this.queryClient.invalidateQueries({
          queryKey: queryKeys.branches.current({ appId }),
        });
        return;
      case "refresh-app":
        void Promise.all([
          this.queryClient.invalidateQueries({
            queryKey: queryKeys.apps.detail({ appId }),
          }),
          this.queryClient.invalidateQueries({
            queryKey: queryKeys.apps.all,
          }),
        ]);
        return;
      case "notify":
        if (command.kind === "success") showSuccess(command.message);
        else if (command.kind === "info") showInfo(command.message);
        else showError(command.message);
        return;
      case "start-conflict-resolution": {
        const runner = this.conflictResolutionRunners.get(appId);
        if (!runner) {
          showError("Conflict resolution is not available on this screen");
          return;
        }
        void Promise.resolve(runner(command.files)).catch((error) => {
          showError(errorMessage(error, "Failed to start conflict resolution"));
        });
        return;
      }
      default:
        return assertNever(command);
    }
  }

  disposeKey(appId: number): void {
    this.invalidateProbes(appId);
    this.gitStateProbeGenerations.delete(appId);
    this.conflictProbeGenerations.delete(appId);
    this.conflictResolutionRunners.delete(appId);
  }

  dispose(): void {
    this.gitStateProbeGenerations.clear();
    this.conflictProbeGenerations.clear();
    this.conflictResolutionRunners.clear();
  }

  private invalidateProbes(appId: number): void {
    this.nextGeneration(this.gitStateProbeGenerations, appId);
    this.nextGeneration(this.conflictProbeGenerations, appId);
  }

  private nextGeneration(
    generations: Map<number, number>,
    appId: number,
  ): number {
    const generation = (generations.get(appId) ?? 0) + 1;
    generations.set(appId, generation);
    return generation;
  }

  private isCurrentGeneration(
    generations: Map<number, number>,
    appId: number,
    generation: number,
  ): boolean {
    return generations.get(appId) === generation;
  }
}

async function runOperation(appId: number, op: GithubOperation): Promise<void> {
  switch (op.type) {
    case "push":
      await ipc.github.push({
        appId,
        force: op.mode === "force",
        forceWithLease: op.mode === "lease",
      });
      return;
    case "pull":
      await ipc.github.pull({ appId });
      return;
    case "fetch":
      await ipc.github.fetch({ appId });
      return;
    case "rebase":
      await ipc.github.rebase({ appId });
      return;
    case "rebase-continue":
      await ipc.github.rebaseContinue({ appId });
      return;
    case "rebase-abort":
      await ipc.github.rebaseAbort({ appId });
      return;
    case "merge-abort":
      await ipc.github.mergeAbort({ appId });
      return;
    case "merge":
      await ipc.github.mergeBranch({ appId, branch: op.branch });
      return;
    case "switch":
      await ipc.github.switchBranch({ appId, branch: op.branch });
      return;
    case "create-branch":
      await ipc.github.createBranch({
        appId,
        branch: op.name,
        from: op.from,
      });
      return;
    case "delete-branch":
      await ipc.github.deleteBranch({ appId, branch: op.branch });
      return;
    case "rename-branch":
      await ipc.github.renameBranch({
        appId,
        oldBranch: op.oldBranch,
        newBranch: op.newBranch,
      });
      return;
    case "disconnect":
      await ipc.github.disconnect({ appId });
      return;
    case "connect-repo":
      if (op.mode === "create") {
        await ipc.github.createRepo({
          appId,
          org: op.org,
          repo: op.repo,
          branch: op.branch,
        });
      } else {
        await ipc.github.connectExistingRepo({
          appId,
          owner: op.owner,
          repo: op.repo,
          branch: op.branch,
        });
      }
      return;
    default:
      return assertNever(op);
  }
}

function operationFailure(error: unknown) {
  const coded = error as { code?: unknown };
  return {
    ...(typeof coded?.code === "string" ? { code: coded.code } : {}),
    kind: isDyadError(error) ? error.kind : "unknown",
    message: errorMessage(error, "GitHub operation failed"),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected github_ops command: ${JSON.stringify(value)}`);
}
