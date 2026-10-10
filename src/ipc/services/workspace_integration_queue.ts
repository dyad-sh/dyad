import fs from "node:fs";
import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps, chats } from "@/db/schema";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { getDyadAppPath } from "@/paths/paths";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import {
  getCurrentCommitHash,
  gitCurrentBranch,
  gitGetMergeConflicts,
  inspectRepositoryHealth,
} from "@/ipc/utils/git_utils";
import {
  commitInProgressMerge,
  diffPathsByStatus,
  fastForwardCheckedOutBranch,
  findFilesWithConflictMarkers,
  isAncestorCommit,
  isMergeInProgress,
  listChangedPaths,
  mergeIntoWorkspace,
  stageAllChanges,
} from "@/ipc/utils/git_worktree_utils";
import {
  isIntegrationActive,
  type IntegrationEvent,
  type IntegrationPhase,
  type IntegrationState,
  type RepairOutcome,
} from "@/workspace_integration/state";
import { transitionIntegration } from "@/workspace_integration/transition";
import { workspaceRuntimeId } from "../../../shared/workspace_runtime_id";
import {
  appOperationCoordinator,
  readAppResource,
} from "./app_operation_coordinator";
import { chatWorkspaceRegistry } from "./chat_workspace_registry";
import {
  getWorkspaceAppPath,
  getWorkspaceById,
  listAllWorkspaces,
  readIntegrationState,
  updateOpenIntegrations,
  updateWorkspace,
  writeIntegrationState,
  type ChatWorkspaceRow,
  type WorkspaceIntegrationRow,
} from "./chat_workspace_store";
import { publishWorkspaceChanged } from "./workspace_events";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { queueCloudSandboxSnapshotSync } from "@/ipc/utils/cloud_sandbox_provider";
import { runWorkspaceScopedOperation } from "./workspace_coordination";
import { buildWorkspaceRepairPrompt } from "./workspace_repair_prompt";
import {
  describeValidationFailure,
  validateWorkspace,
} from "./workspace_validation";

const logger = log.scope("workspace_integration");

const TIMER_RETRY_MS = 15_000;
const TELEMETRY_PHASES = new Set<IntegrationPhase>([
  "resolving-conflicts",
  "merged",
  "paused",
  "failed",
]);
const BUSY_RETRY_MS = 5_000;
const MAX_STEPS_PER_ATTEMPT = 24;

type WaitCondition =
  /** Retry when a writable turn or claim changes in the registry. */
  | { kind: "registry" }
  /** Retry after a delay (branch switched, dirty folder, busy coordinator). */
  | { kind: "timer"; at: number };

type RecordedWait =
  | { kind: "registry"; sinceVersion: number }
  | { kind: "timer"; at: number };

type StepResult = { event: IntegrationEvent; wait?: WaitCondition } | null;

function recordStatusFor(
  phase: IntegrationPhase,
): WorkspaceIntegrationRow["status"] | null {
  switch (phase) {
    case "idle":
      return null;
    case "queued":
    case "merging":
    case "resolving-conflicts":
    case "validating":
    case "integrating":
    case "merged":
    case "paused":
    case "failed":
      return phase;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortHash(hash: string): string {
  return hash.slice(0, 10);
}

function buildMergeMessage(
  workspace: ChatWorkspaceRow,
  targetCommit: string,
): string {
  return [
    `Combine ${workspace.targetBranch} into ${workspace.branch}`,
    "",
    `Brings ${workspace.targetBranch} at ${shortHash(targetCommit)} into this chat's workspace so its work can be fast-forwarded into ${workspace.targetBranch}.`,
    "",
    `Dyad-Chat: ${workspace.chatId}`,
    `Dyad-Workspace: ${workspace.branch}`,
  ].join("\n");
}

/**
 * Executes integration for isolated chat workspaces.
 *
 * Each app has at most one attempt executing (merge, validation, or the final
 * fast-forward). A workspace whose conflicts are being resolved by a repair
 * turn is not executing: it waits for that turn to settle without holding the
 * app's queue, the workspace, or any coordinator claim.
 *
 * The pure lifecycle lives in `src/workspace_integration/transition.ts`; this
 * controller persists each transition before running the commands it emits,
 * so a restart always resumes from the last durable phase.
 */
export class WorkspaceIntegrationQueue {
  private readonly scheduled = new Map<number, Set<number>>();
  private readonly waits = new Map<number, RecordedWait>();
  private readonly activeApps = new Set<number>();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly attemptControllers = new Map<number, AbortController>();
  private unsubscribeRegistry: (() => void) | null = null;
  private stopped = false;

  start(): void {
    this.stopped = false;
    if (this.unsubscribeRegistry) return;
    this.unsubscribeRegistry = chatWorkspaceRegistry.subscribe((appId) => {
      this.kick(appId);
    });
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribeRegistry?.();
    this.unsubscribeRegistry = null;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const controller of this.attemptControllers.values()) {
      controller.abort(new Error("Dyad is shutting down"));
    }
  }

  /**
   * Applies an event to a workspace's persisted integration state and runs
   * the commands the transition emits.
   */
  dispatch(
    workspaceId: number,
    event: IntegrationEvent,
  ): IntegrationState | null {
    const workspace = getWorkspaceById(workspaceId);
    if (!workspace) return null;
    const previous = readIntegrationState(workspace);
    const result = transitionIntegration(previous, event);
    if (result.kind === "ignored") {
      logger.debug(
        `Ignored ${event.type} for workspace ${workspaceId} in ${previous.phase}: ${result.reason}`,
      );
      return previous;
    }
    writeIntegrationState(workspaceId, result.state);
    if (
      result.state.phase !== previous.phase &&
      TELEMETRY_PHASES.has(result.state.phase)
    ) {
      // Fixed fields only: no paths, branch names, or provider/tool output.
      sendTelemetryEvent("workspace:integration", {
        phase: result.state.phase,
        event: event.type,
        repairAttempts: result.state.repairAttempts,
      });
    }
    const recordStatus = recordStatusFor(result.state.phase);
    if (recordStatus) {
      updateOpenIntegrations(workspace.chatId, {
        status: recordStatus,
        detail: result.state.detail,
      });
    }
    publishWorkspaceChanged(workspace.appId);
    for (const command of result.commands) {
      switch (command.type) {
        case "schedule":
        case "merge":
        case "validate":
        case "integrate":
          // Execution steps are derived from the persisted phase by the app's
          // worker, so every one of them only needs the workspace scheduled.
          this.schedule(workspace.appId, workspaceId);
          break;
        case "dispatch-repair":
          this.startRepair(
            workspaceId,
            command.conflictedFiles,
            command.attempt,
          );
          break;
        default: {
          const unreachable: never = command;
          throw new Error(`Unhandled command ${JSON.stringify(unreachable)}`);
        }
      }
    }
    return result.state;
  }

  schedule(appId: number, workspaceId: number): void {
    if (this.stopped) return;
    let workspaces = this.scheduled.get(appId);
    if (!workspaces) {
      workspaces = new Set();
      this.scheduled.set(appId, workspaces);
    }
    workspaces.add(workspaceId);
    this.waits.delete(workspaceId);
    this.kick(appId);
  }

  /** Whether an attempt for this app is executing right now. */
  isAppBusy(appId: number): boolean {
    return this.activeApps.has(appId);
  }

  /** Cancels and forgets a workspace (used before removing it). */
  forget(appId: number, workspaceId: number): void {
    this.scheduled.get(appId)?.delete(workspaceId);
    this.waits.delete(workspaceId);
    const timer = this.timers.get(workspaceId);
    if (timer) clearTimeout(timer);
    this.timers.delete(workspaceId);
    this.attemptControllers
      .get(workspaceId)
      ?.abort(new DyadError("Workspace removed", DyadErrorKind.UserCancelled));
  }

  /** Re-queues every workspace that was mid-integration (startup). */
  resumePending(): void {
    for (const workspace of listAllWorkspaces()) {
      const phase = workspace.integrationStatus;
      if (
        workspace.status === "active" &&
        (phase === "queued" || isIntegrationActive(phase))
      ) {
        this.schedule(workspace.appId, workspace.id);
      }
    }
  }

  /**
   * Settles a turn that ran while a merge was in progress in the workspace:
   * confirm every conflict is really resolved, then complete the merge. A
   * partial resolution is never committed, published, or discarded.
   */
  async settleMergeTurn(
    workspaceId: number,
    turn: { completed: boolean; stepLimitReached: boolean },
  ): Promise<void> {
    const workspace = getWorkspaceById(workspaceId);
    if (!workspace) return;
    const appPath = getWorkspaceAppPath(workspace);
    let outcome: RepairOutcome;
    let detail: string | undefined;
    if (!turn.completed || turn.stepLimitReached) {
      outcome = "interrupted";
      detail = turn.stepLimitReached
        ? "Conflict resolution paused at the step limit. Send a message in this chat to continue."
        : undefined;
    } else {
      try {
        const result = await runWorkspaceScopedOperation(
          {
            appId: workspace.appId,
            workspaceKey: workspaceRuntimeId(workspace.id),
            operation: "complete chat workspace merge",
            appResources: [],
            workspaceResources: ["repository"],
          },
          () => this.completeResolvedMerge(workspace, appPath),
        );
        outcome = result.outcome;
        detail = result.detail;
      } catch (error) {
        logger.error("Failed to complete a resolved merge", error);
        outcome = "unresolved";
        detail = `Dyad couldn't complete the merge: ${errorMessage(error)}`;
      }
    }
    this.dispatch(workspaceId, { type: "REPAIR_SETTLED", outcome, detail });
  }

  private async completeResolvedMerge(
    workspace: ChatWorkspaceRow,
    appPath: string,
  ): Promise<{
    outcome: RepairOutcome;
    detail?: string;
    filesNeedingAttention: string[];
  }> {
    if (!isMergeInProgress(appPath)) {
      // The merge was finished some other way (for example by hand); the
      // queue's next attempt sees the combined history.
      return { outcome: "resolved", filesNeedingAttention: [] };
    }
    const unmerged = await gitGetMergeConflicts({ path: appPath });
    const changed = await listChangedPaths({ path: appPath, from: "HEAD" });
    const withMarkers = await findFilesWithConflictMarkers(appPath, [
      ...new Set([...unmerged, ...changed]),
    ]);
    if (withMarkers.length > 0) {
      return {
        outcome: "unresolved",
        detail: `Conflict markers remain in ${withMarkers.slice(0, 5).join(", ")}${withMarkers.length > 5 ? ` and ${withMarkers.length - 5} more` : ""}. Reply in this chat to finish resolving them.`,
        filesNeedingAttention: withMarkers,
      };
    }
    // Every conflicted file is now marker-free; staging records those
    // resolutions in the index before Git is asked to complete the merge.
    await stageAllChanges(appPath);
    const remaining = await gitGetMergeConflicts({ path: appPath });
    if (remaining.length > 0) {
      return {
        outcome: "unresolved",
        detail: `${remaining.length} file${remaining.length === 1 ? " is" : "s are"} still unmerged.`,
        filesNeedingAttention: remaining,
      };
    }
    const mergeCommit = await commitInProgressMerge(appPath);
    updateOpenIntegrations(workspace.chatId, { mergeCommitHash: mergeCommit });
    return { outcome: "resolved", filesNeedingAttention: [] };
  }

  private kick(appId: number): void {
    if (this.stopped || this.activeApps.has(appId)) return;
    const workspaceId = this.pickNext(appId);
    if (workspaceId === null) return;
    this.activeApps.add(appId);
    void this.advance(appId, workspaceId)
      .catch((error) =>
        logger.error(`Integration worker failed for app ${appId}`, error),
      )
      .finally(() => {
        this.activeApps.delete(appId);
        this.kick(appId);
      });
  }

  private pickNext(appId: number): number | null {
    const workspaces = this.scheduled.get(appId);
    if (!workspaces) return null;
    const now = Date.now();
    for (const workspaceId of workspaces) {
      const wait = this.waits.get(workspaceId);
      if (wait?.kind === "timer" && wait.at > now) continue;
      // Only a change made by someone else can unblock a registry wait.
      if (
        wait?.kind === "registry" &&
        wait.sinceVersion === chatWorkspaceRegistry.changeVersion
      ) {
        continue;
      }
      if (chatWorkspaceRegistry.isWorkspaceLocked(workspaceId)) continue;
      return workspaceId;
    }
    return null;
  }

  private unschedule(appId: number, workspaceId: number): void {
    const workspaces = this.scheduled.get(appId);
    workspaces?.delete(workspaceId);
    if (workspaces?.size === 0) this.scheduled.delete(appId);
    this.waits.delete(workspaceId);
  }

  /**
   * Records why a workspace is waiting. Call only after this worker has
   * released its own claims, so its own release does not count as the change
   * a registry wait is waiting for.
   */
  private wait(appId: number, workspaceId: number, condition: WaitCondition) {
    if (condition.kind === "registry") {
      this.waits.set(workspaceId, {
        kind: "registry",
        sinceVersion: chatWorkspaceRegistry.changeVersion,
      });
      return;
    }
    this.waits.set(workspaceId, condition);
    const existing = this.timers.get(workspaceId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(
      () => {
        this.timers.delete(workspaceId);
        this.kick(appId);
      },
      Math.max(0, condition.at - Date.now()),
    );
    timer.unref?.();
    this.timers.set(workspaceId, timer);
  }

  private async advance(appId: number, workspaceId: number): Promise<void> {
    const workspace = getWorkspaceById(workspaceId);
    const phase = workspace?.integrationStatus;
    if (
      !workspace ||
      workspace.status !== "active" ||
      !phase ||
      !(phase === "queued" || isIntegrationActive(phase))
    ) {
      this.unschedule(appId, workspaceId);
      return;
    }
    const releaseWorkspace =
      chatWorkspaceRegistry.tryClaimWorkspaceForIntegration(appId, workspaceId);
    if (!releaseWorkspace) {
      // A turn is running there; the registry change on release kicks us.
      this.wait(appId, workspaceId, { kind: "registry" });
      return;
    }
    const controller = new AbortController();
    this.attemptControllers.set(workspaceId, controller);
    let pendingWait: WaitCondition | null = null;
    try {
      for (let step = 0; step < MAX_STEPS_PER_ATTEMPT; step++) {
        if (controller.signal.aborted) return;
        const current = getWorkspaceById(workspaceId);
        if (!current || current.status !== "active") {
          this.unschedule(appId, workspaceId);
          return;
        }
        let result: StepResult;
        switch (current.integrationStatus) {
          case "queued":
            result = await this.prepareAttempt(current);
            break;
          case "merging":
            result = await this.mergeTarget(current);
            break;
          case "validating":
            result = await this.validate(current, controller.signal);
            break;
          case "integrating":
            result = await this.integrate(current);
            break;
          default:
            this.unschedule(appId, workspaceId);
            return;
        }
        if (!result || controller.signal.aborted) return;
        const next = this.dispatch(workspaceId, result.event);
        if (result.wait) {
          pendingWait = result.wait;
          return;
        }
        if (
          !next ||
          !(next.phase === "queued" || isIntegrationActive(next.phase))
        ) {
          this.unschedule(appId, workspaceId);
          return;
        }
      }
      // A target that keeps advancing can starve an attempt; yield to other
      // workspaces and come back.
      pendingWait = { kind: "timer", at: Date.now() + BUSY_RETRY_MS };
    } catch (error) {
      logger.error(`Integration failed for workspace ${workspaceId}`, error);
      if (!controller.signal.aborted) {
        this.dispatch(workspaceId, {
          type: "FAILED",
          reason: `Dyad couldn't merge this chat's work: ${errorMessage(error)}`,
        });
      }
      this.unschedule(appId, workspaceId);
    } finally {
      this.attemptControllers.delete(workspaceId);
      releaseWorkspace();
      if (pendingWait) this.wait(appId, workspaceId, pendingWait);
    }
  }

  private async originalAppPath(appId: number): Promise<string | null> {
    const app = await db.query.apps.findFirst({
      columns: { path: true },
      where: eq(apps.id, appId),
    });
    return app ? getDyadAppPath(app.path) : null;
  }

  private async targetPreconditions(
    workspace: ChatWorkspaceRow,
  ): Promise<
    | { kind: "ready"; originalPath: string; targetCommit: string }
    | { kind: "waiting"; reason: string }
    | { kind: "failed"; reason: string }
  > {
    const originalPath = await this.originalAppPath(workspace.appId);
    if (!originalPath)
      return { kind: "failed", reason: "The app no longer exists." };
    const branch = await gitCurrentBranch({ path: originalPath });
    if (branch !== workspace.targetBranch) {
      return {
        kind: "waiting",
        reason: branch
          ? `The app is on branch "${branch}". Switch back to "${workspace.targetBranch}" to merge this chat's work.`
          : `The app is showing an earlier version. Return to "${workspace.targetBranch}" to merge this chat's work.`,
      };
    }
    const targetCommit = await getCurrentCommitHash({
      path: originalPath,
      ref: `refs/heads/${workspace.targetBranch}`,
    });
    return { kind: "ready", originalPath, targetCommit };
  }

  private async prepareAttempt(
    workspace: ChatWorkspaceRow,
  ): Promise<StepResult> {
    const appPath = getWorkspaceAppPath(workspace);
    if (!fs.existsSync(appPath)) {
      return {
        event: {
          type: "FAILED",
          reason: "This chat's workspace folder is missing.",
        },
      };
    }
    const preconditions = await this.targetPreconditions(workspace);
    if (preconditions.kind === "failed") {
      return { event: { type: "FAILED", reason: preconditions.reason } };
    }
    if (preconditions.kind === "waiting") {
      return {
        event: { type: "WAITING", reason: preconditions.reason },
        wait: { kind: "timer", at: Date.now() + TIMER_RETRY_MS },
      };
    }
    const health = await inspectRepositoryHealth({ path: appPath });
    if (health.operationInProgress && health.operationInProgress !== "merge") {
      return {
        event: {
          type: "FAILED",
          reason: `A Git ${health.operationInProgress} is in progress in this chat's workspace. Finish or abort it, then retry.`,
        },
      };
    }
    if (!health.operationInProgress && !health.isClean) {
      return {
        event: {
          type: "WAITING",
          reason:
            "This chat's workspace has uncommitted changes. They'll be merged after the chat's next turn finishes.",
        },
        wait: { kind: "timer", at: Date.now() + TIMER_RETRY_MS },
      };
    }
    return {
      event: {
        type: "STARTED",
        // An interrupted merge keeps the target it started with.
        targetCommit:
          health.operationInProgress === "merge" &&
          workspace.integrationTargetCommit
            ? workspace.integrationTargetCommit
            : preconditions.targetCommit,
      },
    };
  }

  private async mergeTarget(workspace: ChatWorkspaceRow): Promise<StepResult> {
    const appPath = getWorkspaceAppPath(workspace);
    const targetCommit = workspace.integrationTargetCommit;
    if (!targetCommit) {
      return {
        event: { type: "FAILED", reason: "No target commit captured." },
      };
    }
    updateOpenIntegrations(workspace.chatId, {
      targetCommitHash: targetCommit,
    });
    if (isMergeInProgress(appPath)) {
      const conflicts = await gitGetMergeConflicts({ path: appPath });
      if (conflicts.length > 0) {
        return {
          event: { type: "MERGE_CONFLICTED", conflictedFiles: conflicts },
        };
      }
      const completion = await runWorkspaceScopedOperation(
        {
          appId: workspace.appId,
          workspaceKey: workspaceRuntimeId(workspace.id),
          operation: "complete chat workspace merge",
          appResources: [],
          workspaceResources: ["repository"],
        },
        () => this.completeResolvedMerge(workspace, appPath),
      );
      if (completion.outcome !== "resolved") {
        return {
          event: {
            type: "MERGE_CONFLICTED",
            conflictedFiles: completion.filesNeedingAttention,
          },
        };
      }
      return { event: { type: "MERGE_CLEAN" } };
    }
    if (
      await isAncestorCommit({
        path: appPath,
        ancestor: "HEAD",
        descendant: targetCommit,
      })
    ) {
      return { event: { type: "NOTHING_TO_INTEGRATE" } };
    }
    const result = await runWorkspaceScopedOperation(
      {
        appId: workspace.appId,
        workspaceKey: workspaceRuntimeId(workspace.id),
        operation: "merge target branch into chat workspace",
        appResources: [],
        workspaceResources: ["repository"],
      },
      () =>
        mergeIntoWorkspace({
          worktreePath: appPath,
          ref: targetCommit,
          message: buildMergeMessage(workspace, targetCommit),
          allowFastForward: false,
        }),
    );
    switch (result.kind) {
      case "up-to-date":
      case "fast-forward":
        return { event: { type: "MERGE_CLEAN" } };
      case "merged":
        updateOpenIntegrations(workspace.chatId, {
          mergeCommitHash: result.mergeCommit,
        });
        return { event: { type: "MERGE_CLEAN" } };
      case "conflicts":
        return {
          event: {
            type: "MERGE_CONFLICTED",
            conflictedFiles: result.conflictedFiles,
          },
        };
      default: {
        const unreachable: never = result;
        throw new Error(
          `Unhandled merge result ${JSON.stringify(unreachable)}`,
        );
      }
    }
  }

  private async validate(
    workspace: ChatWorkspaceRow,
    signal: AbortSignal,
  ): Promise<StepResult> {
    const appPath = getWorkspaceAppPath(workspace);
    const originalPath = await this.originalAppPath(workspace.appId);
    // Only compare type errors against the original directory when it holds
    // exactly the captured target, so a dirty or moved checkout cannot hide
    // or invent errors.
    let baselineAppPath: string | undefined;
    if (originalPath && workspace.integrationTargetCommit) {
      try {
        const health = await inspectRepositoryHealth({ path: originalPath });
        if (
          health.isClean &&
          !health.operationInProgress &&
          health.headOid === workspace.integrationTargetCommit
        ) {
          baselineAppPath = originalPath;
        }
      } catch (error) {
        logger.warn("Could not inspect the original directory", error);
      }
    }
    const result = await validateWorkspace({
      appPath,
      baselineAppPath,
      signal,
    });
    updateWorkspace(workspace.id, { validationJson: result.checks });
    updateOpenIntegrations(workspace.chatId, {
      validationJson: result.checks,
    });
    if (signal.aborted) return null;
    return result.passed
      ? { event: { type: "VALIDATION_PASSED" } }
      : {
          event: {
            type: "VALIDATION_FAILED",
            summary: `The combined code didn't pass its checks, so ${workspace.targetBranch} was left unchanged. ${describeValidationFailure(result.checks)}`,
          },
        };
  }

  private async integrate(workspace: ChatWorkspaceRow): Promise<StepResult> {
    const releaseOriginal =
      chatWorkspaceRegistry.tryClaimOriginalForIntegration(workspace.appId);
    if (!releaseOriginal) {
      return {
        event: {
          type: "WAITING",
          reason:
            "Waiting for the agent working in the app's main folder to finish.",
        },
        wait: { kind: "registry" },
      };
    }
    try {
      if (appOperationCoordinator.isBusy(workspace.appId, ["repository"])) {
        return {
          event: {
            type: "WAITING",
            reason: "Waiting for another operation on the app to finish.",
          },
          wait: { kind: "timer", at: Date.now() + BUSY_RETRY_MS },
        };
      }
      return await runWorkspaceScopedOperation(
        {
          appId: workspace.appId,
          workspaceKey: workspaceRuntimeId(workspace.id),
          operation: "integrate chat workspace",
          appResources: [readAppResource("app-path"), "repository"],
          workspaceResources: [readAppResource("repository")],
          refuseWhenRecording: "merge a chat's isolated work",
        },
        () => this.fastForwardTarget(workspace),
      );
    } catch (error) {
      if (isDyadError(error) && error.kind === DyadErrorKind.Precondition) {
        return {
          event: { type: "WAITING", reason: error.message },
          wait: { kind: "timer", at: Date.now() + TIMER_RETRY_MS },
        };
      }
      throw error;
    } finally {
      releaseOriginal();
    }
  }

  /** Runs under the app's repository claim; rechecks everything first. */
  private async fastForwardTarget(
    workspace: ChatWorkspaceRow,
  ): Promise<StepResult> {
    const preconditions = await this.targetPreconditions(workspace);
    if (preconditions.kind === "failed") {
      return { event: { type: "FAILED", reason: preconditions.reason } };
    }
    if (preconditions.kind === "waiting") {
      return {
        event: { type: "WAITING", reason: preconditions.reason },
        wait: { kind: "timer", at: Date.now() + TIMER_RETRY_MS },
      };
    }
    const { originalPath, targetCommit } = preconditions;
    const health = await inspectRepositoryHealth({ path: originalPath });
    if (health.operationInProgress) {
      return {
        event: {
          type: "WAITING",
          reason: `A Git ${health.operationInProgress} is in progress in the app's main folder.`,
        },
        wait: { kind: "timer", at: Date.now() + TIMER_RETRY_MS },
      };
    }
    if (!health.isClean) {
      return {
        event: {
          type: "WAITING",
          reason:
            "The app's main folder has uncommitted changes. Commit or discard them to merge this chat's work.",
        },
        wait: { kind: "timer", at: Date.now() + TIMER_RETRY_MS },
      };
    }
    const workspaceHead = await getCurrentCommitHash({
      path: getWorkspaceAppPath(workspace),
    });
    if (
      await isAncestorCommit({
        path: originalPath,
        ancestor: workspaceHead,
        descendant: targetCommit,
      })
    ) {
      return { event: { type: "NOTHING_TO_INTEGRATE" } };
    }
    if (
      !(await isAncestorCommit({
        path: originalPath,
        ancestor: targetCommit,
        descendant: workspaceHead,
      }))
    ) {
      // The target advanced after validation: combine and validate again.
      return { event: { type: "TARGET_ADVANCED", targetCommit } };
    }
    try {
      await fastForwardCheckedOutBranch({
        worktreePath: originalPath,
        ref: workspaceHead,
      });
    } catch (error) {
      return {
        event: {
          type: "WAITING",
          reason: `Dyad couldn't update the app's main folder: ${errorMessage(error)}`,
        },
        wait: { kind: "timer", at: Date.now() + TIMER_RETRY_MS },
      };
    }
    updateWorkspace(workspace.id, { lastIntegratedCommit: workspaceHead });
    updateOpenIntegrations(workspace.chatId, {
      status: "merged",
      integratedCommitHash: workspaceHead,
      targetCommitHash: targetCommit,
    });
    // Like any other edit to the app's folder, the merged files reach its
    // cloud sandbox when it runs in one.
    try {
      const { changed, deleted } = await diffPathsByStatus({
        path: originalPath,
        from: targetCommit,
        to: workspaceHead,
      });
      queueCloudSandboxSnapshotSync({
        appId: workspace.appId,
        changedPaths: changed,
        deletedPaths: deleted,
      });
    } catch (error) {
      logger.warn("Failed to sync merged files to the cloud sandbox", error);
    }
    queryInvalidationBus.publish([
      { family: "versions", appId: workspace.appId },
      { family: "uncommitted-files", appId: workspace.appId },
      { family: "app", appId: workspace.appId },
    ]);
    return { event: { type: "INTEGRATED" } };
  }

  private startRepair(
    workspaceId: number,
    conflictedFiles: readonly string[],
    attempt: number,
  ): void {
    void (async () => {
      const workspace = getWorkspaceById(workspaceId);
      if (!workspace) return;
      const chat = await db.query.chats.findFirst({
        columns: { chatMode: true },
        where: eq(chats.id, workspace.chatId),
      });
      if (!chat) return;
      const prompt = await buildWorkspaceRepairPrompt({
        chatId: workspace.chatId,
        workspaceAppPath: getWorkspaceAppPath(workspace),
        workspaceBranch: workspace.branch,
        targetBranch: workspace.targetBranch,
        conflictedFiles,
        attempt,
        validationFailures: workspace.validationJson,
      });
      // Breaks the import cycle chat_stream_handlers -> workspace service ->
      // this queue -> chat actor -> chat_stream_handlers.
      const { dispatchWorkspaceRepairTurn } =
        await import("./chat_actor_service");
      const result = await dispatchWorkspaceRepairTurn({
        workspaceId,
        chatId: workspace.chatId,
        appId: workspace.appId,
        prompt,
        requestedChatMode: chat.chatMode === "build" ? "build" : "local-agent",
      });
      if (result === "rejected") {
        this.dispatch(workspaceId, {
          type: "REPAIR_SETTLED",
          outcome: "interrupted",
          detail:
            "Dyad couldn't start resolving conflicts in this chat. Send a message to continue.",
        });
      }
    })().catch((error) => {
      logger.error("Failed to start a conflict-resolution turn", error);
      this.dispatch(workspaceId, {
        type: "REPAIR_SETTLED",
        outcome: "interrupted",
        detail: `Dyad couldn't start resolving conflicts: ${errorMessage(error)}`,
      });
    });
  }
}

export const workspaceIntegrationQueue = new WorkspaceIntegrationQueue();
