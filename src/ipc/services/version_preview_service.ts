import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  assertAppFolderExists,
  assertAppGitRepository,
} from "@/ipc/utils/app_git_repository";
import type { VersionCommandResult } from "@/ipc/types";
import { getDyadAppPath } from "@/paths/paths";
import type { PreviewCommand, RestoreRecovery } from "@/version_preview/state";
import type { CurrentRepositoryAssessment } from "@/version_preview/state";
import {
  getCurrentCommitHash,
  getGitUncommittedFilesWithStatus,
  gitAddAll,
  gitCommit,
  gitCurrentBranch,
  inspectRepositoryHealth,
} from "../utils/git_utils";
import {
  appOperationCoordinator,
  readAppResource,
} from "./app_operation_coordinator";
import { versionPreviewHandlerService } from "../handlers/version_handlers";
import { versionPreviewPresentationService } from "./version_preview_presentation_service";
import {
  beginAppChatActorMutation,
  hasActiveAppChatActors,
} from "./chat_actor_service";
import {
  blockNewStreamsForApp,
  hasActiveStreamsForApp,
} from "../handlers/chat_stream_handlers";

const NO_BRANCH = "<no-branch>";

export type CurrentRepositoryValidation =
  | {
      kind: "healthy";
      branch: string;
      headOid: string;
      savedVersionId?: string;
    }
  | { kind: "dirty" }
  | {
      kind: "blocked";
      assessment: Exclude<CurrentRepositoryAssessment, { type: "dirty" }>;
      message: string;
    };

export class VersionPreviewService {
  private readonly deletionFences = new Map<number, number>();
  private readonly reconcilingApps = new Set<number>();
  private readonly pendingByApp = new Map<number, Set<Promise<unknown>>>();
  private resetFenceCount = 0;

  run(
    command: Extract<
      PreviewCommand,
      {
        type:
          | "checkout"
          | "return"
          | "switch-branch"
          | "restore"
          | "restore-to-message";
      }
    >,
    operationId?: string,
    onRestoreProgress?: (progress: RestoreRecovery) => void,
  ): Promise<VersionCommandResult> {
    if (command.type !== "return") {
      try {
        this.assertAcceptingOperations(command.appId);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    let operation: Promise<VersionCommandResult>;
    switch (command.type) {
      case "checkout":
        operation = versionPreviewHandlerService.checkoutVersion({
          purpose: "preview",
          appId: command.appId,
          versionId: command.versionId,
        });
        break;
      case "return":
      case "switch-branch":
        operation = versionPreviewHandlerService.checkoutVersion({
          purpose: "return",
          appId: command.appId,
          branch: command.branch,
        });
        break;
      case "restore":
        operation = this.prepareRestore(command, onRestoreProgress).then(() =>
          versionPreviewHandlerService.revertVersion(
            {
              appId: command.appId,
              previousVersionId: command.versionId,
              expectedHeadOid: command.expectedHeadOid,
              currentChatMessageId: command.currentChatMessageId,
              targetBranchName: command.targetBranch ?? undefined,
            },
            onRestoreProgress,
          ),
        );
        break;
      case "restore-to-message":
        operation = this.prepareRestore(command, onRestoreProgress).then(() =>
          versionPreviewHandlerService.restoreToMessage(
            {
              appId: command.appId,
              chatId: command.chatId,
              messageId: command.messageId,
              restoreCodebase: command.restoreCodebase,
              targetBranchName: command.targetBranch ?? undefined,
            },
            operationId
              ? versionPreviewPresentationService.originEndpointFor(operationId)
              : undefined,
            onRestoreProgress,
          ),
        );
        break;
    }
    return this.track(command.appId, operation);
  }

  resolveOriginBranch(appId: number): Promise<{ branch: string | null }> {
    try {
      this.assertAcceptingOperations(appId);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.track(
      appId,
      (async () => {
        const app = await db.query.apps.findFirst({
          columns: { path: true },
          where: eq(apps.id, appId),
        });
        if (!app) {
          throw new DyadError("App not found", DyadErrorKind.NotFound);
        }
        const appPath = getDyadAppPath(app.path);
        await assertAppGitRepository(appPath);
        const branch = await gitCurrentBranch({ path: appPath });
        return { branch: branch && branch !== NO_BRANCH ? branch : null };
      })(),
    );
  }

  reconcile(appId: number): Promise<{
    branch: string | null;
    headOid: string | null;
    isClean: boolean;
  }> {
    return this.track(
      appId,
      (async () => {
        const app = await db.query.apps.findFirst({
          columns: { path: true },
          where: eq(apps.id, appId),
        });
        if (!app) {
          throw new DyadError("App not found", DyadErrorKind.NotFound);
        }
        const appPath = getDyadAppPath(app.path);
        await assertAppGitRepository(appPath);
        const [branch, headOid, uncommittedFiles] = await Promise.all([
          gitCurrentBranch({ path: appPath }),
          getCurrentCommitHash({ path: appPath }),
          getGitUncommittedFilesWithStatus({ path: appPath }),
        ]);
        return {
          branch: branch && branch !== NO_BRANCH ? branch : null,
          headOid: headOid || null,
          isClean: uncommittedFiles.length === 0,
        };
      })(),
    );
  }

  validateCurrentRepository(
    appId: number,
  ): Promise<CurrentRepositoryValidation> {
    return this.track(
      appId,
      this.runRepositoryRecoveryOperation({
        appId,
        operation: "validate-current-version",
        refuseWhenRecording: "use the current version",
        resources: [readAppResource("app-path"), readAppResource("repository")],
        execute: () => this.inspectCurrentRepository(appId),
      }),
    );
  }

  checkpointCurrentRepository(
    appId: number,
  ): Promise<CurrentRepositoryValidation> {
    return this.track(
      appId,
      this.runRepositoryRecoveryOperation({
        appId,
        operation: "checkpoint-current-version",
        refuseWhenRecording: "save the current version",
        resources: [readAppResource("app-path"), "repository"],
        execute: async () => {
          const before = await this.inspectCurrentRepository(appId);
          if (before.kind === "blocked" || before.kind === "healthy") {
            return before;
          }

          const app = await db.query.apps.findFirst({
            columns: { path: true },
            where: eq(apps.id, appId),
          });
          if (!app) {
            return this.missingRepository("App not found");
          }
          const appPath = getDyadAppPath(app.path);
          await gitAddAll({ path: appPath });
          const savedVersionId = await gitCommit({
            path: appPath,
            message:
              "[Recovery] Saved current changes before continuing Version History",
          });
          const after = await this.inspectCurrentRepository(appId);
          if (after.kind !== "healthy") {
            return after.kind === "dirty"
              ? {
                  kind: "blocked",
                  assessment: {
                    type: "blocked",
                    blocker: "repository-error",
                  },
                  message:
                    "The current changes were saved, but the repository is still not clean. Check the project and try again.",
                }
              : after;
          }
          return { ...after, savedVersionId };
        },
      }),
    );
  }

  private async runRepositoryRecoveryOperation<Result>({
    appId,
    operation,
    refuseWhenRecording,
    resources,
    execute,
  }: {
    appId: number;
    operation: string;
    refuseWhenRecording: string;
    resources: Parameters<typeof appOperationCoordinator.run>[0]["resources"];
    execute: () => Promise<Result>;
  }): Promise<Result> {
    const releaseStreamAdmission = blockNewStreamsForApp(appId);
    let releaseActorAdmission: (() => void) | undefined;
    try {
      releaseActorAdmission = await beginAppChatActorMutation(appId);
      const [hasActorStream, hasLegacyStream] = await Promise.all([
        hasActiveAppChatActors(appId),
        hasActiveStreamsForApp(appId),
      ]);
      if (hasActorStream || hasLegacyStream) {
        throw new DyadError(
          "Stop the active generation before continuing Version History.",
          DyadErrorKind.Precondition,
        );
      }
      return await appOperationCoordinator.run(
        {
          appId,
          operation,
          resources,
          refuseWhenRecording,
        },
        execute,
      );
    } finally {
      releaseActorAdmission?.();
      releaseStreamAdmission();
    }
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

  beginReconciliation(appId: number): void {
    this.reconcilingApps.add(appId);
  }

  endReconciliation(appId: number): void {
    this.reconcilingApps.delete(appId);
  }

  assertReadyForIntent(appId: number): void {
    this.assertAcceptingOperations(appId);
    if (this.reconcilingApps.has(appId)) {
      throw new DyadError(
        "Version preview is reconciling after restart",
        DyadErrorKind.Precondition,
      );
    }
  }

  async settle(appId: number): Promise<void> {
    while (this.pendingByApp.get(appId)?.size) {
      await Promise.allSettled(this.pendingByApp.get(appId) ?? []);
    }
  }

  private async prepareRestore(
    command: Extract<
      PreviewCommand,
      { type: "restore" | "restore-to-message" }
    >,
    onRestoreProgress?: (progress: RestoreRecovery) => void,
  ): Promise<void> {
    if (!onRestoreProgress) {
      return;
    }
    if (command.type === "restore-to-message" && !command.restoreCodebase) {
      return;
    }
    const app = await db.query.apps.findFirst({
      columns: { path: true },
      where: eq(apps.id, command.appId),
    });
    if (!app) {
      throw new DyadError("App not found", DyadErrorKind.NotFound);
    }
    const appPath = getDyadAppPath(app.path);
    const [preRestoreHead, currentBranch] = await Promise.all([
      getCurrentCommitHash({
        path: appPath,
        ref: command.targetBranch ?? "HEAD",
      }),
      command.targetBranch
        ? Promise.resolve(command.targetBranch)
        : gitCurrentBranch({ path: appPath }),
    ]);
    onRestoreProgress({
      preRestoreHead,
      preRestoreBranch:
        currentBranch && currentBranch !== NO_BRANCH ? currentBranch : null,
      targetHead: command.type === "restore" ? command.versionId : null,
      nextStep: "preparing",
    });
  }

  private missingRepository(message: string): CurrentRepositoryValidation {
    return {
      kind: "blocked",
      assessment: { type: "blocked", blocker: "missing-repository" },
      message,
    };
  }

  private async inspectCurrentRepository(
    appId: number,
  ): Promise<CurrentRepositoryValidation> {
    const app = await db.query.apps.findFirst({
      columns: { path: true },
      where: eq(apps.id, appId),
    });
    if (!app) return this.missingRepository("App not found");
    const appPath = getDyadAppPath(app.path);
    if (!fs.existsSync(path.join(appPath, ".git"))) {
      try {
        await assertAppFolderExists(appPath);
      } catch (error) {
        // Explain a missing or inaccessible app folder instead.
        if (error instanceof Error) {
          return this.missingRepository(error.message);
        }
      }
      return this.missingRepository(
        "The project repository could not be found.",
      );
    }

    const health = await inspectRepositoryHealth({ path: appPath });
    if (health.unmergedFiles.length > 0) {
      return {
        kind: "blocked",
        assessment: { type: "blocked", blocker: "conflicted" },
        message:
          "This project has unresolved file conflicts. Resolve them outside Dyad, then check again.",
      };
    }
    if (health.operationInProgress) {
      return {
        kind: "blocked",
        assessment: {
          type: "blocked",
          blocker: "git-operation",
          operation: health.operationInProgress,
        },
        message: `A Git ${health.operationInProgress} is still in progress. Finish or cancel it outside Dyad, then check again.`,
      };
    }
    if (!health.branch) {
      return {
        kind: "blocked",
        assessment: { type: "blocked", blocker: "detached-head" },
        message:
          "This project is not on a named branch. Return it to a branch outside Dyad, then check again.",
      };
    }
    if (!health.isClean) return { kind: "dirty" };
    return {
      kind: "healthy",
      branch: health.branch,
      headOid: health.headOid,
    };
  }

  trackLifecycle<Result>(
    appId: number,
    promise: Promise<Result>,
  ): Promise<Result> {
    return this.track(appId, promise);
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

export const versionPreviewService = new VersionPreviewService();
