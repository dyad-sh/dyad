import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  apps,
  chats,
  messages,
  versions,
  type WorkspaceValidationCheck,
} from "@/db/schema";
import { storeDbTimestampAtCurrentVersion } from "@/ipc/utils/neon_timestamp_utils";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import {
  getCurrentCommitHash,
  gitCommit,
  gitCurrentBranch,
  gitGetMergeConflicts,
  inspectRepositoryHealth,
} from "@/ipc/utils/git_utils";
import {
  commitInProgressMerge,
  createSquashCommit,
  diffPathsByStatus,
  fastForwardCheckedOutBranch,
  findFilesWithConflictMarkers,
  getCommitSubject,
  getCommitTree,
  haveSameTree,
  isAncestorCommit,
  isMergeInProgress,
  listChangedPaths,
  listCommitsNotIn,
  listUncommittedPaths,
  mergeIntoWorkspace,
  recordMergedCommit,
  restorePathsToHead,
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
  getOriginalAppPath,
  getWorkspaceAppPath,
  getWorkspaceById,
  integratedHead,
  isWorkspaceIntegrated,
  listAllWorkspaces,
  toAppRelativePath,
  readIntegrationState,
  updateWorkspace,
  writeIntegrationState,
  type ChatWorkspaceRow,
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
/**
 * A registry wait also re-checks after this long, in case the change it
 * waits for landed between the failed claim and the wait being recorded.
 */
const REGISTRY_WAIT_FALLBACK_MS = 15_000;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Subject of the commit `commitInstallChanges` makes; never a version name. */
const INSTALL_COMMIT_SUBJECT = "Update dependency files from install";

function shortHash(hash: string): string {
  return hash.slice(0, 10);
}

/**
 * Message of the one commit a chat's validated work lands as. Its subject is
 * the latest turn's summary (what the version list shows); the trailers say
 * which chat, worktree, and turns it came from.
 */
async function buildSquashMessage(
  workspace: ChatWorkspaceRow,
  workspaceHead: string,
): Promise<string> {
  const appPath = getWorkspaceAppPath(workspace);
  const own = await listCommitsNotIn({
    path: appPath,
    from: workspaceHead,
    exclude: integratedHead(workspace),
    firstParent: true,
    noMerges: true,
  }).catch(() => []);
  const turns =
    own.length > 0
      ? await db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.chatId, workspace.chatId),
              inArray(messages.commitHash, own),
            ),
          )
          .orderBy(messages.id)
      : [];
  // The newest turn's own summary, skipping the dependency-file commit an
  // attempt can make just before squashing.
  let subject = "";
  for (const commit of own) {
    const candidate = await getCommitSubject({
      path: appPath,
      ref: commit,
    }).catch(() => "");
    if (candidate && candidate !== INSTALL_COMMIT_SUBJECT) {
      subject = candidate;
      break;
    }
  }
  subject ||= `Changes from chat #${workspace.chatId}`;
  return [
    subject,
    "",
    `Squashed ${own.length} commit${own.length === 1 ? "" : "s"} from ${workspace.branch} into one after the combined code passed its checks.`,
    "",
    `Dyad-Chat: ${workspace.chatId}`,
    `Dyad-Workspace: ${workspace.branch}`,
    ...turns.map(({ id }) => `Dyad-Turn: ${id}`),
  ].join("\n");
}

/**
 * Database restore points (Neon timestamps) are recorded on the turns' own
 * commits in the worktree, but the squash is the version the app's branch
 * shows, so it gets the newest one among the commits it includes. Each is
 * taken as a turn starts, so that is the database from before the last
 * turn; `stampSquashWithDatabaseNow` replaces it once Neon answers.
 */
async function carryDbTimestampToSquash(
  workspace: ChatWorkspaceRow,
  workspaceHead: string,
  squash: string,
): Promise<void> {
  // First parents only: the chat's own turns and merges, never other chats'
  // squashes that a merge brought in (they carry their own timestamps).
  const included = await listCommitsNotIn({
    path: getWorkspaceAppPath(workspace),
    from: workspaceHead,
    exclude: integratedHead(workspace),
    firstParent: true,
  });
  if (included.length === 0) return;
  const stamped = new Map(
    (
      await db
        .select({
          commitHash: versions.commitHash,
          neonDbTimestamp: versions.neonDbTimestamp,
        })
        .from(versions)
        .where(
          and(
            eq(versions.appId, workspace.appId),
            inArray(versions.commitHash, included),
            isNotNull(versions.neonDbTimestamp),
          ),
        )
    ).map((row) => [row.commitHash, row.neonDbTimestamp]),
  );
  // Newest first, as rev-list lists them.
  const newest = included.map((commit) => stamped.get(commit)).find(Boolean);
  if (!newest) return;
  await db
    .insert(versions)
    .values({
      appId: workspace.appId,
      commitHash: squash,
      neonDbTimestamp: newest,
    })
    .onConflictDoNothing();
}

/**
 * Records the database as it is now as the squash's restore point: every
 * included turn has run by the time its work lands, and the worktree's next
 * turn stamps its own commit, never the squash. Runs after the attempt so a
 * slow Neon request never holds the app's claims.
 */
function stampSquashWithDatabaseNow(appId: number, squash: string): void {
  void (async () => {
    const app = await db.query.apps.findFirst({
      columns: {
        neonProjectId: true,
        neonActiveBranchId: true,
        neonDevelopmentBranchId: true,
      },
      where: eq(apps.id, appId),
    });
    if (
      !app?.neonProjectId ||
      !(app.neonActiveBranchId || app.neonDevelopmentBranchId)
    ) {
      return;
    }
    await storeDbTimestampAtCurrentVersion({ appId, commitHash: squash });
  })().catch((error) =>
    logger.warn(`Failed to record the database state for ${squash}`, error),
  );
}

/** Files a dependency install rewrites by itself. */
const INSTALL_WRITTEN_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "pnpm-workspace.yaml",
]);

function isInstallWrittenFile(file: string): boolean {
  return INSTALL_WRITTEN_FILES.has(path.posix.basename(file));
}

/**
 * The app folder's own preview installs rewrite lockfiles there, and nothing
 * commits them while chats work in worktrees. When the squash changes such a
 * file, the fast-forward would refuse and ask the user about a file they
 * never touched; put it back as the target has it instead, since the squash
 * brings the chat's version and the next install rewrites it anyway. Any
 * other uncommitted file in the way is left for the user.
 */
async function discardInstallRewritesInTheWay({
  originalPath,
  from,
  to,
}: {
  originalPath: string;
  from: string;
  to: string;
}): Promise<void> {
  const dirty = new Set(await listUncommittedPaths(originalPath));
  if (dirty.size === 0) return;
  const inTheWay = (
    await listChangedPaths({ path: originalPath, from, to })
  ).filter((file) => dirty.has(file));
  if (inTheWay.length === 0 || !inTheWay.every(isInstallWrittenFile)) return;
  logger.info(
    `Restoring ${inTheWay.join(", ")} in the app's folder: an install rewrote them and the merge changes them`,
  );
  await restorePathsToHead({ checkoutPath: originalPath, files: inTheWay });
}

/**
 * The worktree's own preview runs installs there, which can rewrite
 * lockfiles (and pnpm-workspace.yaml) with nobody's turn left to commit
 * them. (Validation installs in a separate snapshot.) When those are the
 * only uncommitted changes, commit them so integration does not wait for
 * another turn. Returns whether it did.
 */
async function commitInstallChanges(
  workspace: ChatWorkspaceRow,
): Promise<boolean> {
  const appPath = getWorkspaceAppPath(workspace);
  const dirty = await listUncommittedPaths(workspace.path);
  if (dirty.length === 0 || !dirty.every(isInstallWrittenFile)) {
    return false;
  }
  await stageAllChanges(workspace.path);
  await gitCommit({
    path: appPath,
    message: [
      INSTALL_COMMIT_SUBJECT,
      "",
      `Dyad-Chat: ${workspace.chatId}`,
      `Dyad-Workspace: ${workspace.branch}`,
    ].join("\n"),
  });
  return true;
}

/**
 * Records in the workspace that `squash` (its own content, now on the
 * target) is part of its history, so later merges with the target start from
 * it. Returns the workspace HEAD to remember as integrated.
 */
export async function recordIntegratedSquash(
  workspace: ChatWorkspaceRow,
  squash: string,
): Promise<string> {
  return recordMergedCommit({
    worktreePath: getWorkspaceAppPath(workspace),
    commit: squash,
    message: [
      `Record ${shortHash(squash)} on ${workspace.targetBranch}`,
      "",
      `This chat's work landed on ${workspace.targetBranch} as ${shortHash(squash)}. No files change here.`,
      "",
      `Dyad-Chat: ${workspace.chatId}`,
      `Dyad-Workspace: ${workspace.branch}`,
    ].join("\n"),
  });
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
  /**
   * The tree that last passed validation, per workspace. Checks depend only
   * on the files, so an attempt that restarts after waiting (for the app's
   * folder to be clean, another operation, a branch switch) does not install,
   * build, and test the identical result again.
   */
  private readonly passedTrees = new Map<number, string>();
  /**
   * The squash made for an attempt, reused while the target and the files
   * stay the same, so a fast-forward that keeps waiting (a local change in
   * the app's folder) does not write a new commit object every retry.
   */
  private readonly squashes = new Map<
    number,
    { parent: string; tree: string; squash: string }
  >();
  /**
   * The tree that last failed type-check, build, or tests, per workspace.
   * Those checks give the same answer for the same files, so later automatic
   * requests (a text-only turn) do not rerun them; Retry clears it. Install
   * failures (often the network) and checks that timed out or could not run
   * are never remembered.
   */
  private readonly failedTrees = new Map<
    number,
    { tree: string; checks: WorkspaceValidationCheck[] }
  >();
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
    this.passedTrees.delete(workspaceId);
    this.failedTrees.delete(workspaceId);
    this.squashes.delete(workspaceId);
  }

  /** Forgets remembered validation results, so Retry checks again. */
  forgetValidation(workspaceId: number): void {
    this.passedTrees.delete(workspaceId);
    this.failedTrees.delete(workspaceId);
  }

  /**
   * Stops an app's integration attempts and their queue state, before app
   * deletion drains admitted work: a validation can hold app claims for many
   * minutes.
   */
  stopApp(appId: number): void {
    for (const workspace of listAllWorkspaces()) {
      if (workspace.appId === appId) this.forget(appId, workspace.id);
    }
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
    // Git reports paths relative to the repository root, which is the
    // worktree root, not the app's folder when the app lives in a subfolder.
    const unmerged = await gitGetMergeConflicts({ path: appPath });
    const changed = await listChangedPaths({ path: appPath, from: "HEAD" });
    const withMarkers = await findFilesWithConflictMarkers(workspace.path, [
      ...new Set([...unmerged, ...changed]),
    ]);
    if (withMarkers.length > 0) {
      const shown = withMarkers
        .slice(0, 5)
        .map((file) => toAppRelativePath(workspace, file));
      return {
        outcome: "unresolved",
        detail: `Conflict markers remain in ${shown.join(", ")}${withMarkers.length > 5 ? ` and ${withMarkers.length - 5} more` : ""}. Reply in this chat to finish resolving them.`,
        filesNeedingAttention: withMarkers,
      };
    }
    // Every conflicted file is now marker-free; staging records those
    // resolutions in the index before Git is asked to complete the merge.
    // From the worktree root: a conflict can be outside the app's subfolder
    // (a monorepo's root lockfile), and Git resolved some of those itself.
    await stageAllChanges(workspace.path);
    const remaining = await gitGetMergeConflicts({ path: appPath });
    if (remaining.length > 0) {
      return {
        outcome: "unresolved",
        detail: `${remaining.length} file${remaining.length === 1 ? " is" : "s are"} still unmerged.`,
        filesNeedingAttention: remaining,
      };
    }
    await commitInProgressMerge(appPath);
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
    const recorded: RecordedWait =
      condition.kind === "registry"
        ? {
            kind: "registry",
            sinceVersion: chatWorkspaceRegistry.changeVersion,
          }
        : condition;
    this.waits.set(workspaceId, recorded);
    const existing = this.timers.get(workspaceId);
    if (existing) clearTimeout(existing);
    const at =
      condition.kind === "registry"
        ? Date.now() + REGISTRY_WAIT_FALLBACK_MS
        : condition.at;
    const timer = setTimeout(
      () => {
        this.timers.delete(workspaceId);
        // Timers can fire a moment before Date.now() reaches `at`; drop the
        // wait so pickNext cannot skip it with no timer left to retry.
        if (this.waits.get(workspaceId) === recorded) {
          this.waits.delete(workspaceId);
        }
        this.kick(appId);
      },
      Math.max(0, at - Date.now()),
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

  private async targetPreconditions(
    workspace: ChatWorkspaceRow,
  ): Promise<
    | { kind: "ready"; originalPath: string; targetCommit: string }
    | { kind: "waiting"; reason: string }
    | { kind: "failed"; reason: string }
  > {
    const originalPath = await getOriginalAppPath(workspace.appId);
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
    // Not gated on `isClean`: it ignores pnpm-workspace.yaml, which the
    // preview's install can rewrite on its own and a merge would then refuse.
    if (
      !health.operationInProgress &&
      (await commitInstallChanges(workspace))
    ) {
      return this.prepareAttempt(getWorkspaceById(workspace.id) ?? workspace);
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
    // An interrupted merge keeps the target it is merging (MERGE_HEAD), not
    // whatever the target has moved to since.
    const mergingCommit =
      health.operationInProgress === "merge"
        ? await getCurrentCommitHash({
            path: appPath,
            ref: "MERGE_HEAD",
          }).catch(() => null)
        : null;
    return {
      event: {
        type: "STARTED",
        targetCommit: mergingCommit ?? preconditions.targetCommit,
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
    if (await isWorkspaceIntegrated(workspace)) {
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
      case "merged":
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
    const originalPath = await getOriginalAppPath(workspace.appId);
    // Only compare type errors against the original directory when it holds
    // exactly the captured target, so a dirty or moved checkout cannot hide
    // or invent errors. Lockfiles its own preview's install rewrote do not
    // change the source, and nothing commits them while chats use worktrees.
    let baselineAppPath: string | undefined;
    if (originalPath && workspace.integrationTargetCommit) {
      try {
        const health = await inspectRepositoryHealth({ path: originalPath });
        if (
          !health.operationInProgress &&
          health.headOid === workspace.integrationTargetCommit &&
          (health.isClean ||
            (await listUncommittedPaths(originalPath)).every(
              (file) => file.startsWith(".dyad/") || isInstallWrittenFile(file),
            ))
        ) {
          baselineAppPath = originalPath;
        }
      } catch (error) {
        logger.warn("Could not inspect the original directory", error);
      }
    }
    const tree = await getCommitTree({ path: appPath, ref: "HEAD" });
    if (this.passedTrees.get(workspace.id) === tree) {
      return { event: { type: "VALIDATION_PASSED" } };
    }
    const failed = this.failedTrees.get(workspace.id);
    if (failed?.tree === tree) {
      return {
        event: {
          type: "VALIDATION_FAILED",
          summary: `The combined code didn't pass its checks, so ${workspace.targetBranch} was left unchanged. ${describeValidationFailure(failed.checks)}`,
        },
      };
    }
    const result = await runWorkspaceScopedOperation(
      {
        appId: workspace.appId,
        workspaceKey: workspaceRuntimeId(workspace.id),
        operation: "validate chat workspace",
        appResources: [readAppResource("app-path")],
        workspaceResources: [readAppResource("repository")],
      },
      () => validateWorkspace({ appPath, baselineAppPath, signal }),
    );
    updateWorkspace(workspace.id, { validationJson: result.checks });
    if (signal.aborted) return null;
    if (result.passed) {
      this.passedTrees.set(workspace.id, tree);
      this.failedTrees.delete(workspace.id);
    } else if (
      !result.transientFailure &&
      !result.checks.some(
        (check) => check.name === "install" && check.outcome !== "passed",
      )
    ) {
      this.failedTrees.set(workspace.id, { tree, checks: result.checks });
    }
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
          // Writes the record of the squash into the workspace's history.
          workspaceResources: ["repository"],
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

  /**
   * Runs under the app's repository claim; rechecks everything first. The
   * validated workspace lands as one squash commit on top of the target, and
   * a successful fast-forward to it is the integration: the workspace's own
   * commits are never looked for in the target's history.
   */
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
    // Uncommitted changes in the main folder do not block the merge by
    // themselves (Dyad's own writes, like a .gitignore entry or a lockfile
    // from the main preview's install, are never committed while chats work
    // in worktrees): the fast-forward refuses only when it would overwrite
    // them, and then the user is asked to commit or discard those files.
    const workspaceHead = await getCurrentCommitHash({
      path: getWorkspaceAppPath(workspace),
    });
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
    if (
      await haveSameTree({
        path: originalPath,
        a: workspaceHead,
        b: targetCommit,
      })
    ) {
      // The target already has every file as the workspace has it (for
      // example after undoing work that was never merged).
      updateWorkspace(workspace.id, { lastIntegratedCommit: workspaceHead });
      return { event: { type: "NOTHING_TO_INTEGRATE" } };
    }
    // Only the files that passed validation may land. A turn can commit
    // while an attempt is between steps (it yielded, or Dyad restarted while
    // "integrating"), so anything else is combined and validated again.
    const tree = await getCommitTree({
      path: originalPath,
      ref: workspaceHead,
    });
    if (this.passedTrees.get(workspace.id) !== tree) {
      return { event: { type: "TARGET_ADVANCED", targetCommit } };
    }
    const previous = this.squashes.get(workspace.id);
    const squash =
      previous?.parent === targetCommit && previous.tree === tree
        ? previous.squash
        : await createSquashCommit({
            path: originalPath,
            source: workspaceHead,
            parent: targetCommit,
            message: await buildSquashMessage(workspace, workspaceHead),
          });
    this.squashes.set(workspace.id, { parent: targetCommit, tree, squash });
    await discardInstallRewritesInTheWay({
      originalPath,
      from: targetCommit,
      to: squash,
    }).catch((error) =>
      logger.warn("Failed to restore install-written files", error),
    );
    try {
      await fastForwardCheckedOutBranch({
        worktreePath: originalPath,
        ref: squash,
      });
    } catch (error) {
      const message = errorMessage(error);
      return {
        event: {
          type: "WAITING",
          reason: /would be overwritten/.test(message)
            ? "The app's main folder has uncommitted changes to files this chat also changed. Commit or discard them to merge this chat's work."
            : `Dyad couldn't update the app's main folder: ${message}`,
        },
        wait: { kind: "timer", at: Date.now() + TIMER_RETRY_MS },
      };
    }
    await carryDbTimestampToSquash(workspace, workspaceHead, squash).catch(
      (error) =>
        logger.warn(
          `Failed to carry the database timestamp to ${squash}`,
          error,
        ),
    );
    stampSquashWithDatabaseNow(workspace.appId, squash);
    // The fast-forward succeeded, so the work is integrated. Recording the
    // squash keeps the next merge with the target from re-applying it; if
    // that fails, the next merge still works from the files themselves.
    let integrated = workspaceHead;
    try {
      integrated = await recordIntegratedSquash(workspace, squash);
    } catch (error) {
      logger.error(
        `Failed to record ${shortHash(squash)} in workspace ${workspace.id}`,
        error,
      );
    }
    updateWorkspace(workspace.id, { lastIntegratedCommit: integrated });
    this.squashes.delete(workspace.id);
    // Like any other edit to the app's folder, the merged files reach its
    // cloud sandbox when it runs in one.
    try {
      const { changed, deleted } = await diffPathsByStatus({
        path: originalPath,
        from: targetCommit,
        to: squash,
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
        repositoryPath: workspace.path,
        appSubpath: workspace.appSubpath,
        workspaceBranch: workspace.branch,
        targetBranch: workspace.targetBranch,
        conflictedFiles,
        attempt,
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
