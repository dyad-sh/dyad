import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { VersionCommandResult } from "@/ipc/types";
import { getDyadAppPath } from "@/paths/paths";
import type { PreviewCommand, RestoreRecovery } from "@/version_preview/state";
import { getCurrentCommitHash, gitCurrentBranch } from "../utils/git_utils";
import { versionPreviewHandlerService } from "../handlers/version_handlers";
import { versionPreviewPresentationService } from "./version_preview_presentation_service";

const NO_BRANCH = "<no-branch>";

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
        if (!fs.existsSync(path.join(appPath, ".git"))) {
          throw new DyadError("Not a git repository", DyadErrorKind.External);
        }
        const branch = await gitCurrentBranch({ path: appPath });
        return { branch: branch && branch !== NO_BRANCH ? branch : null };
      })(),
    );
  }

  reconcile(
    appId: number,
  ): Promise<{ branch: string | null; headOid: string | null }> {
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
        if (!fs.existsSync(path.join(appPath, ".git"))) {
          throw new DyadError("Not a git repository", DyadErrorKind.External);
        }
        const [branch, headOid] = await Promise.all([
          gitCurrentBranch({ path: appPath }),
          getCurrentCommitHash({ path: appPath }),
        ]);
        return {
          branch: branch && branch !== NO_BRANCH ? branch : null,
          headOid: headOid || null,
        };
      })(),
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
    if (
      !onRestoreProgress ||
      (command.type === "restore-to-message" && !command.restoreCodebase)
    ) {
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
    const preRestoreHead = await getCurrentCommitHash({
      path: appPath,
      ref: command.targetBranch ?? "HEAD",
    });
    onRestoreProgress({
      preRestoreHead,
      targetHead: command.type === "restore" ? command.versionId : null,
      nextStep: "preparing",
    });
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
