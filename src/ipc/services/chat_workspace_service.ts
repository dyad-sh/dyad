import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps, chats } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import { getDyadAppPath } from "@/paths/paths";
import {
  DEFAULT_WORKTREE_ISOLATION_IDLE_HOURS,
  DEFAULT_WORKTREE_ISOLATION_MAX_WORKSPACES_PER_APP,
} from "@/shared/settings_defaults";
import {
  execGit,
  getCurrentCommitHash,
  gitCurrentBranch,
  gitGetMergeConflicts,
  inspectRepositoryHealth,
} from "@/ipc/utils/git_utils";
import {
  addBranchWorktree,
  deleteMergedBranch,
  excludeDyadMetadata,
  gitBranchExists,
  isAncestorCommit,
  isMergeInProgress,
  isWorktreeLinkBroken,
  listChangedPaths,
  mergeIntoWorkspace,
  pruneGitWorktrees,
  removeLinkedWorktree,
  repairLinkedWorktrees,
} from "@/ipc/utils/git_worktree_utils";
import { runningApps, stopAppByInfo } from "@/ipc/utils/process_manager";
import { appRunActorService } from "./app_run_actor_service";
import { appRuntimeService } from "./app_runtime_service";
import {
  ATTACHMENTS_MANIFEST_FILE,
  getDyadMediaDir,
} from "@/ipc/utils/media_path_utils";
import type { IntegrationPhase } from "@/workspace_integration/state";
import {
  planDirForAppPath,
  planSlugForChat,
} from "@/ipc/handlers/planPersistence";
import { workspaceRuntimeId } from "../../../shared/workspace_runtime_id";
import { readAppResource } from "./app_operation_coordinator";
import {
  chatWorkspaceRegistry,
  type WritableTurnReservation,
} from "./chat_workspace_registry";
import {
  buildWorkspaceRootPath,
  deleteWorkspaceRow,
  getActiveWorkspaceForChat,
  getChatWorkspacesRoot,
  getWorkspaceAppPath,
  getWorkspaceById,
  getWorkspaceForChat,
  insertWorkspace,
  listAllWorkspaces,
  listWorkspacesForApp,
  recordIntegrationRequest,
  renameBranchReferences,
  touchWorkspace,
  updateWorkspace,
  type ChatWorkspaceRow,
} from "./chat_workspace_store";
import { publishWorkspaceChanged } from "./workspace_events";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { workspaceIntegrationQueue } from "./workspace_integration_queue";
import { runWorkspaceScopedOperation } from "./workspace_coordination";

const logger = log.scope("chat_workspace_service");

const MARKER_SCHEMA = "dyad-chat-workspace-v1";
const CAPACITY_RECHECK_MS = 30_000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const FORCED_REMOVAL_WAIT_MS = 30_000;

interface WorkspaceMarker {
  schema: typeof MARKER_SCHEMA;
  appId: number;
  chatId: number;
  sourceRepoPath: string;
  branch: string;
}

/** Where a turn runs and what it must know about that workspace. */
export interface TurnWorkspace {
  readonly appId: number;
  readonly chatId: number;
  readonly kind: "original" | "isolated";
  readonly workspaceId: number | null;
  /**
   * Directory the turn reads and edits. For the app's original folder this
   * is the path when the turn started; re-resolve it from the app row after
   * any wait, since the app can be moved.
   */
  readonly appPath: string;
  readonly branch: string | null;
  readonly targetBranch: string | null;
  readonly writable: boolean;
  /**
   * Runtime the turn's preview, log, and lifecycle tools address. Equal to
   * the app id for the original directory.
   */
  readonly runtimeAppId: number;
  /** Coordinator key for the workspace's files, or undefined (original). */
  readonly coordinationKey: number | undefined;
  /** Facts about the workspace the agent must know before editing. */
  readonly promptNotes: readonly string[];
  /** Filled in by the turn before it settles. */
  readonly outcome: {
    completed: boolean;
    stepLimitReached: boolean;
    messageId: number | null;
  };
  /** Runs the settlement hook once and releases the workspace. */
  settle(): Promise<void>;
}

export interface PrepareTurnWorkspaceInput {
  appId: number;
  chatId: number;
  originalAppPath: string;
  writable: boolean;
  /** False for chats whose execution backend cannot change directories. */
  allowIsolation: boolean;
  /**
   * False when applying changes already generated against the workspace's
   * current code (approving a proposal): merging newer target work in first
   * would let those changes overwrite it. Defaults to true.
   */
  synchronize?: boolean;
  signal: AbortSignal;
  /** Reports why the turn is waiting, or null when it stops waiting. */
  onWaiting?: (message: string | null) => void;
}

export function getWorktreeIsolationLimits() {
  const settings = readSettings();
  return {
    enabled: settings.enableWorktreeIsolation === true,
    maxWorkspaces:
      settings.worktreeIsolationMaxWorkspacesPerApp ??
      DEFAULT_WORKTREE_ISOLATION_MAX_WORKSPACES_PER_APP,
    idleHours:
      settings.worktreeIsolationIdleHours ??
      DEFAULT_WORKTREE_ISOLATION_IDLE_HOURS,
  };
}

function markerPath(worktreeRoot: string): string {
  return `${worktreeRoot}.owner.json`;
}

async function writeMarker(
  worktreeRoot: string,
  marker: WorkspaceMarker,
): Promise<void> {
  await fsPromises.mkdir(path.dirname(worktreeRoot), { recursive: true });
  const target = markerPath(worktreeRoot);
  const temporary = `${target}.tmp`;
  await fsPromises.writeFile(temporary, JSON.stringify(marker), "utf8");
  await fsPromises.rename(temporary, target);
}

async function readMarker(
  worktreeRoot: string,
): Promise<WorkspaceMarker | null> {
  try {
    const parsed = JSON.parse(
      await fsPromises.readFile(markerPath(worktreeRoot), "utf8"),
    ) as Partial<WorkspaceMarker>;
    if (
      parsed.schema !== MARKER_SCHEMA ||
      typeof parsed.sourceRepoPath !== "string" ||
      !path.isAbsolute(parsed.sourceRepoPath) ||
      typeof parsed.branch !== "string"
    ) {
      return null;
    }
    return parsed as WorkspaceMarker;
  } catch {
    return null;
  }
}

async function originalAppPathFor(appId: number): Promise<string | null> {
  const app = await db.query.apps.findFirst({
    columns: { path: true },
    where: eq(apps.id, appId),
  });
  return app ? getDyadAppPath(app.path) : null;
}

async function uniqueBranchName(
  repositoryPath: string,
  chatId: number,
): Promise<string> {
  const base = `dyad/chat-${chatId}`;
  if (!(await gitBranchExists({ path: repositoryPath, branch: base }))) {
    return base;
  }
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!(await gitBranchExists({ path: repositoryPath, branch: candidate }))) {
      return candidate;
    }
  }
  throw new DyadError(
    "Could not choose a branch name for the isolated workspace",
    DyadErrorKind.Conflict,
  );
}

/**
 * Untracked environment files (`.env`, `.env.local`, …) hold configuration a
 * preview or build needs. They are never committed, so a fresh worktree would
 * otherwise start without them. Uncommitted source edits are not copied.
 */
async function copyEnvironmentFiles(
  fromAppPath: string,
  toAppPath: string,
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsPromises.readdir(fromAppPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(".env")) continue;
    const destination = path.join(toAppPath, entry.name);
    if (fs.existsSync(destination)) continue;
    await fsPromises
      .copyFile(path.join(fromAppPath, entry.name), destination)
      .catch((error) =>
        logger.warn(`Failed to copy ${entry.name} into workspace`, error),
      );
  }
}

/**
 * Uploaded attachments and generated media live in the original folder's
 * `.dyad/media` (gitignored). Agent tools resolve them relative to the folder
 * they work in, so a turn in a worktree gets the original's media mirrored in
 * (content-addressed files are copied once; the manifest is refreshed), and
 * media the turn creates is mirrored back so the media library keeps it.
 */
async function mirrorMedia(
  fromAppPath: string,
  toAppPath: string,
  { includeManifest }: { includeManifest: boolean },
): Promise<void> {
  const fromDir = getDyadMediaDir(fromAppPath);
  const toDir = getDyadMediaDir(toAppPath);
  let entries: fs.Dirent[];
  try {
    entries = await fsPromises.readdir(fromDir, { withFileTypes: true });
  } catch {
    return;
  }
  await fsPromises.mkdir(toDir, { recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const isManifest = entry.name === ATTACHMENTS_MANIFEST_FILE;
    if (isManifest && !includeManifest) continue;
    const destination = path.join(toDir, entry.name);
    if (!isManifest && fs.existsSync(destination)) continue;
    await fsPromises
      .copyFile(
        path.join(fromDir, entry.name),
        destination,
        fs.constants.COPYFILE_FICLONE,
      )
      .catch((error) =>
        logger.warn(`Failed to mirror media file ${entry.name}`, error),
      );
  }
}

/**
 * A chat's plan lives in the app folder's `.dyad/plans` (gitignored), but
 * `/implement-plan` asks the agent to mark progress in its working plan with
 * ordinary file tools, which resolve paths inside the workspace. The chat's
 * plan files are copied in before a turn. Returns the working plan's content
 * so settlement copies it back only when the turn changed it.
 */
async function mirrorChatPlansIn(
  fromAppPath: string,
  toAppPath: string,
  chatId: number,
): Promise<string | null> {
  const slug = planSlugForChat(chatId);
  const fromDir = planDirForAppPath(fromAppPath);
  let names: string[];
  try {
    names = (await fsPromises.readdir(fromDir)).filter(
      (name) =>
        name === `${slug}.md` ||
        (name.startsWith(`${slug}-`) && name.endsWith(".md")),
    );
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  const toDir = planDirForAppPath(toAppPath);
  await fsPromises.mkdir(toDir, { recursive: true });
  for (const name of names) {
    await fsPromises.copyFile(path.join(fromDir, name), path.join(toDir, name));
  }
  return fsPromises
    .readFile(path.join(toDir, `${slug}.md`), "utf8")
    .catch(() => null);
}

async function mirrorWorkingPlanBack(
  fromAppPath: string,
  toAppPath: string,
  chatId: number,
  baseline: string | null,
): Promise<void> {
  const name = `${planSlugForChat(chatId)}.md`;
  const content = await fsPromises
    .readFile(path.join(planDirForAppPath(fromAppPath), name), "utf8")
    .catch(() => null);
  if (content === null || content === baseline) return;
  const toDir = planDirForAppPath(toAppPath);
  await fsPromises.mkdir(toDir, { recursive: true });
  await fsPromises.writeFile(path.join(toDir, name), content, "utf8");
}

/** Copies the app's media and the chat's plans into its workspace. */
async function mirrorIntoWorkspace(
  originalAppPath: string,
  workspace: ChatWorkspaceRow,
  chatId: number,
): Promise<{ planBaseline: string | null }> {
  await excludeDyadMetadata(workspace.path);
  const workspaceAppPath = getWorkspaceAppPath(workspace);
  await mirrorMedia(originalAppPath, workspaceAppPath, {
    includeManifest: true,
  });
  return {
    planBaseline: await mirrorChatPlansIn(
      originalAppPath,
      workspaceAppPath,
      chatId,
    ),
  };
}

class ChatWorkspaceService {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Chooses where a turn runs. Writable turns reserve their placement for the
   * whole turn; `settle()` must be called exactly once, in `finally`.
   */
  async prepareTurnWorkspace(
    input: PrepareTurnWorkspaceInput,
  ): Promise<TurnWorkspace> {
    return input.writable
      ? this.prepareWritableTurn(input)
      : this.prepareReadOnlyTurn(input);
  }

  private async prepareReadOnlyTurn(
    input: PrepareTurnWorkspaceInput,
  ): Promise<TurnWorkspace> {
    const workspace = getActiveWorkspaceForChat(input.chatId);
    if (!workspace) {
      return this.buildHandle(input, null, [], async () => undefined);
    }
    // Ask and Plan read the chat's workspace as it is: no worktree is created
    // and nothing is synchronized or integrated.
    const releaseReader = chatWorkspaceRegistry.tryAddReader(
      input.appId,
      workspace.id,
    );
    if (!releaseReader) {
      // The workspace is being removed (its work is fully merged), so the
      // original folder has the same code.
      return this.buildHandle(input, null, [], async () => undefined);
    }
    try {
      await this.ensureLinked(workspace);
      await mirrorIntoWorkspace(input.originalAppPath, workspace, input.chatId);
    } catch (error) {
      releaseReader();
      throw error;
    }
    return this.buildHandle(input, workspace, [], async () => {
      releaseReader();
    });
  }

  private async prepareWritableTurn(
    input: PrepareTurnWorkspaceInput,
  ): Promise<TurnWorkspace> {
    const { appId, chatId, signal } = input;
    let waitingMessage: string | null = null;
    const setWaiting = (message: string | null) => {
      if (message === waitingMessage) return;
      waitingMessage = message;
      input.onWaiting?.(message);
    };
    try {
      while (true) {
        signal.throwIfAborted();
        const existing = getWorkspaceForChat(chatId);
        if (existing && existing.status !== "active") {
          // The chat's previous workspace is still being cleaned up (or set
          // up by an interrupted attempt); a chat has one workspace at most.
          setWaiting(
            "Waiting for this chat's previous workspace to be cleaned up…",
          );
          await Promise.race([
            chatWorkspaceRegistry.waitForChange(signal),
            new Promise((resolve) => {
              const timer = setTimeout(resolve, 2_000);
              timer.unref?.();
            }),
          ]);
          continue;
        }
        const usableExisting = existing;
        const limits = getWorktreeIsolationLimits();
        const decision = chatWorkspaceRegistry.reserveWritableTurn({
          appId,
          chatId,
          existingWorkspaceId: usableExisting?.id ?? null,
          isolationEnabled: limits.enabled && input.allowIsolation,
        });
        switch (decision.kind) {
          case "wait": {
            setWaiting(
              decision.reason === "original-integrating"
                ? "Waiting for Dyad to finish merging another chat's work…"
                : "Waiting for Dyad to finish checking this chat's combined changes…",
            );
            await chatWorkspaceRegistry.waitForChange(signal);
            continue;
          }
          case "original":
            return this.buildHandle(input, null, [], async () => {
              chatWorkspaceRegistry.release(decision.reservation);
            });
          case "existing-workspace": {
            const reservation = decision.reservation;
            try {
              const workspace = await this.ensureCheckout(usableExisting!);
              if (!workspace) {
                // The workspace could not be restored; start over without it.
                chatWorkspaceRegistry.release(reservation);
                continue;
              }
              touchWorkspace(workspace.id);
              const notes = await this.prepareExistingWorkspace(workspace, {
                synchronize: input.synchronize !== false,
              });
              const mirrored = await mirrorIntoWorkspace(
                input.originalAppPath,
                workspace,
                chatId,
              );
              return this.buildHandle(input, workspace, notes, (handle) =>
                this.settleIsolatedTurn(
                  workspace.id,
                  reservation,
                  handle,
                  mirrored.planBaseline,
                ),
              );
            } catch (error) {
              chatWorkspaceRegistry.release(reservation);
              throw error;
            }
          }
          case "new-workspace": {
            const reservation = decision.reservation;
            const created = await this.createForReservation(
              input,
              reservation,
              setWaiting,
            );
            if (created === "original") {
              return this.buildHandle(input, null, [], async () => {
                chatWorkspaceRegistry.release(reservation);
              });
            }
            let mirrored: Awaited<ReturnType<typeof mirrorIntoWorkspace>>;
            try {
              mirrored = await mirrorIntoWorkspace(
                input.originalAppPath,
                created,
                chatId,
              );
            } catch (error) {
              chatWorkspaceRegistry.release(reservation);
              throw error;
            }
            return this.buildHandle(
              input,
              created,
              [
                `This chat now works in its own isolated workspace on branch \`${created.branch}\`, created from the latest committed \`${created.targetBranch}\` because another chat is changing this app at the same time. Uncommitted edits from other chats are not here. Dyad merges this chat's finished work into \`${created.targetBranch}\` after checking the combined code.`,
              ],
              (handle) =>
                this.settleIsolatedTurn(
                  created.id,
                  reservation,
                  handle,
                  mirrored.planBaseline,
                ),
            );
          }
          default: {
            const unreachable: never = decision;
            throw new Error(
              `Unhandled decision ${JSON.stringify(unreachable)}`,
            );
          }
        }
      }
    } finally {
      setWaiting(null);
    }
  }

  /**
   * Creates the workspace a `new-workspace` reservation stands for, waiting
   * (and explaining why) while the app is at capacity. Falls back to the
   * original directory if the other writers finish in the meantime.
   */
  private async createForReservation(
    input: PrepareTurnWorkspaceInput,
    reservation: WritableTurnReservation,
    setWaiting: (message: string | null) => void,
  ): Promise<ChatWorkspaceRow | "original"> {
    const { appId, chatId, signal } = input;
    try {
      while (true) {
        signal.throwIfAborted();
        if (chatWorkspaceRegistry.fallBackToOriginal(reservation)) {
          return "original";
        }
        const { maxWorkspaces } = getWorktreeIsolationLimits();
        const countLive = () =>
          listWorkspacesForApp(appId).filter(
            (workspace) => workspace.status !== "removing",
          ).length;
        if (countLive() >= maxWorkspaces) {
          await this.sweepApp(appId, { needSlots: 1 });
        }
        // Synchronous from the count to the slot, so two turns can never
        // both take the last slot.
        if (
          chatWorkspaceRegistry.tryStartWorkspaceCreation(reservation, {
            liveWorkspaces: countLive(),
            maxWorkspaces,
          })
        ) {
          try {
            const original = await originalAppPathFor(appId);
            if (!original) {
              throw new DyadError("App not found", DyadErrorKind.NotFound);
            }
            const branch = await gitCurrentBranch({ path: original });
            if (branch) {
              setWaiting(null);
              const workspace = await this.createWorkspace({
                appId,
                chatId,
                originalAppPath: original,
                targetBranch: branch,
              });
              chatWorkspaceRegistry.bindWorkspace(reservation, workspace.id);
              return workspace;
            }
            setWaiting(
              "Waiting for the app to return to a branch: it is showing an earlier version, so there is no branch to start isolated work from.",
            );
          } finally {
            chatWorkspaceRegistry.abandonWorkspaceCreation(reservation);
          }
        } else {
          setWaiting(
            `Waiting for an isolated workspace: all ${maxWorkspaces} workspaces for this app are in use by chats with running agents, unmerged work, or open previews. This turn starts as soon as one is merged and idle or another chat finishes.`,
          );
        }
        await Promise.race([
          chatWorkspaceRegistry.waitForChange(signal),
          new Promise((resolve) => {
            const timer = setTimeout(resolve, CAPACITY_RECHECK_MS);
            timer.unref?.();
          }),
        ]);
      }
    } catch (error) {
      chatWorkspaceRegistry.release(reservation);
      throw error;
    }
  }

  private async createWorkspace({
    appId,
    chatId,
    originalAppPath,
    targetBranch,
  }: {
    appId: number;
    chatId: number;
    originalAppPath: string;
    targetBranch: string;
  }): Promise<ChatWorkspaceRow> {
    return runWorkspaceScopedOperation(
      {
        appId,
        operation: "create isolated chat workspace",
        // A new branch and worktree registration are additive: they never
        // touch the original checkout's index, files, or current branch.
        appResources: [
          readAppResource("app-path"),
          readAppResource("repository-ref"),
        ],
        workspaceResources: [],
      },
      async () => {
        const repositoryRoot = (
          await execGit(["rev-parse", "--show-toplevel"], originalAppPath)
        ).stdout.trim();
        const realRoot = await fsPromises.realpath(repositoryRoot);
        const realApp = await fsPromises.realpath(originalAppPath);
        const appSubpath = path.relative(realRoot, realApp);
        if (appSubpath.startsWith("..") || path.isAbsolute(appSubpath)) {
          throw new DyadError(
            "The app is outside its Git repository",
            DyadErrorKind.Precondition,
          );
        }
        const baseCommit = await getCurrentCommitHash({
          path: originalAppPath,
          ref: `refs/heads/${targetBranch}`,
        });
        const branch = await uniqueBranchName(originalAppPath, chatId);
        const worktreeRoot = buildWorkspaceRootPath(appId, chatId);
        await writeMarker(worktreeRoot, {
          schema: MARKER_SCHEMA,
          appId,
          chatId,
          sourceRepoPath: realRoot,
          branch,
        });
        const row = insertWorkspace({
          appId,
          chatId,
          path: worktreeRoot,
          appSubpath,
          branch,
          targetBranch,
          baseCommit,
        });
        try {
          await addBranchWorktree({
            repositoryPath: originalAppPath,
            worktreePath: worktreeRoot,
            branch,
            startPoint: baseCommit,
          });
          await copyEnvironmentFiles(originalAppPath, getWorkspaceAppPath(row));
          updateWorkspace(row.id, { status: "active" });
        } catch (error) {
          logger.error("Failed to create isolated workspace", error);
          await removeLinkedWorktree({
            repositoryPath: originalAppPath,
            worktreePath: worktreeRoot,
          }).catch(() => undefined);
          await deleteMergedBranch({
            repositoryPath: originalAppPath,
            branch,
          }).catch(() => undefined);
          await fsPromises
            .rm(markerPath(worktreeRoot), { force: true })
            .catch(() => undefined);
          deleteWorkspaceRow(row.id);
          throw error;
        }
        logger.info(
          `Created isolated workspace ${worktreeRoot} on ${branch} for chat ${chatId}`,
        );
        sendTelemetryEvent("workspace:created", {
          liveWorkspaces: listWorkspacesForApp(appId).length,
        });
        publishWorkspaceChanged(appId);
        return getWorkspaceById(row.id)!;
      },
    );
  }

  /**
   * Restores a workspace whose directory disappeared (for example deleted by
   * hand) from its branch. Returns null when the branch is gone too.
   */
  private async ensureCheckout(
    workspace: ChatWorkspaceRow,
  ): Promise<ChatWorkspaceRow | null> {
    if (fs.existsSync(getWorkspaceAppPath(workspace))) {
      await this.ensureLinked(workspace);
      return workspace;
    }
    const original = await originalAppPathFor(workspace.appId);
    if (!original) return null;
    await pruneGitWorktrees(original);
    if (
      !(await gitBranchExists({ path: original, branch: workspace.branch }))
    ) {
      logger.warn(
        `Workspace ${workspace.id} lost its folder and branch; dropping it`,
      );
      deleteWorkspaceRow(workspace.id);
      publishWorkspaceChanged(workspace.appId);
      return null;
    }
    await fsPromises.mkdir(path.dirname(workspace.path), { recursive: true });
    const result = await execGit(
      ["worktree", "add", workspace.path, workspace.branch],
      original,
    );
    if (result.exitCode !== 0) {
      throw new DyadError(
        `Could not restore this chat's workspace: ${result.stderr.trim()}`,
        DyadErrorKind.External,
      );
    }
    await copyEnvironmentFiles(original, getWorkspaceAppPath(workspace));
    return workspace;
  }

  /**
   * Inspects a reused workspace before a writable turn. Unfinished work and
   * interrupted Git operations are preserved and described to the agent; a
   * clean, fully integrated workspace is synchronized with its target.
   */
  private async prepareExistingWorkspace(
    workspace: ChatWorkspaceRow,
    { synchronize }: { synchronize: boolean },
  ): Promise<string[]> {
    const appPath = getWorkspaceAppPath(workspace);
    const health = await inspectRepositoryHealth({ path: appPath });
    if (health.operationInProgress === "merge") {
      const conflicts = await gitGetMergeConflicts({ path: appPath });
      return [
        `A merge of \`${workspace.targetBranch}\` into this chat's workspace is in progress so this chat's earlier work can be integrated.${conflicts.length > 0 ? ` These files still conflict: ${conflicts.join(", ")}.` : ""} Before starting anything new, finish resolving it: edit each conflicted file so both this chat's task and the changes from \`${workspace.targetBranch}\` keep working, and remove every conflict marker. Do not commit or abort the merge; Dyad completes and checks it after this turn.`,
      ];
    }
    if (health.operationInProgress) {
      return [
        `A Git ${health.operationInProgress} is in progress in this chat's workspace. Inspect it with the git tools before making other changes; do not discard it.`,
      ];
    }
    if (!health.isClean) {
      return [
        "This chat's workspace has uncommitted changes from an earlier turn that did not finish. Review them (for example with git status and git diff) and continue from them instead of starting over.",
      ];
    }
    const targetRef = `refs/heads/${workspace.targetBranch}`;
    const unintegrated = !(await isAncestorCommit({
      path: appPath,
      ancestor: "HEAD",
      descendant: targetRef,
    }));
    if (unintegrated) {
      // Earlier work that never reached the target (queued, paused, failed,
      // or undone) is preserved; this turn's completion requests integration
      // for all of it together.
      return [
        `This chat's earlier work is not merged into \`${workspace.targetBranch}\` yet${workspace.integrationDetail ? ` (${workspace.integrationDetail})` : ""}. It is preserved in this workspace; Dyad merges it together with this turn's changes.`,
      ];
    }
    if (!synchronize) return [];
    // Clean and fully integrated: bring in what other chats merged since.
    const before = await getCurrentCommitHash({ path: appPath });
    let result: Awaited<ReturnType<typeof mergeIntoWorkspace>>;
    try {
      result = await runWorkspaceScopedOperation(
        {
          appId: workspace.appId,
          workspaceKey: workspaceRuntimeId(workspace.id),
          operation: "synchronize chat workspace",
          appResources: [],
          workspaceResources: ["repository"],
        },
        () =>
          mergeIntoWorkspace({
            worktreePath: appPath,
            ref: targetRef,
            allowFastForward: true,
            message: `Synchronize ${workspace.branch} with ${workspace.targetBranch}\n\nDyad-Chat: ${workspace.chatId}\nDyad-Workspace: ${workspace.branch}`,
          }),
      );
    } catch (error) {
      logger.warn(`Failed to synchronize workspace ${workspace.id}`, error);
      return [
        `Dyad couldn't update this workspace with the latest \`${workspace.targetBranch}\` before this turn, so recent work from other chats may be missing here. It will be combined when this chat's work is merged.`,
      ];
    }
    if (result.kind === "up-to-date") return [];
    if (result.kind === "conflicts") {
      // Unreachable for a fully integrated workspace, but never leave a
      // half-merged tree behind a sync.
      await execGit(["merge", "--abort"], appPath);
      return [];
    }
    const changed = await listChangedPaths({
      path: appPath,
      from: before,
      to: "HEAD",
    });
    publishWorkspaceChanged(workspace.appId);
    return [
      `Since this chat's last turn, other work was merged into \`${workspace.targetBranch}\` and this workspace was updated to include it (${changed.length} file${changed.length === 1 ? "" : "s"} changed${changed.length > 0 ? `: ${changed.slice(0, 30).join(", ")}${changed.length > 30 ? ", …" : ""}` : ""}). Your earlier view of these files may be out of date: read the current version of any file before editing it.`,
    ];
  }

  private requestIntegration(
    workspace: ChatWorkspaceRow,
    messageId: number | null,
    userInitiated: boolean,
  ): void {
    void (async () => {
      const head = await getCurrentCommitHash({
        path: getWorkspaceAppPath(workspace),
      });
      recordIntegrationRequest({
        appId: workspace.appId,
        chatId: workspace.chatId,
        messageId,
        workspaceBranch: workspace.branch,
        targetBranch: workspace.targetBranch,
        sourceCommitHash: head,
      });
      workspaceIntegrationQueue.dispatch(workspace.id, {
        type: "REQUESTED",
        userInitiated,
      });
    })().catch((error) =>
      logger.error(
        `Failed to request integration for workspace ${workspace.id}`,
        error,
      ),
    );
  }

  /** Retries a paused or failed integration on the user's request. */
  async retryIntegration(chatId: number): Promise<void> {
    const workspace = getWorkspaceForChat(chatId);
    if (!workspace || workspace.status !== "active") {
      throw new DyadError(
        "This chat has no isolated workspace",
        DyadErrorKind.NotFound,
      );
    }
    workspaceIntegrationQueue.dispatch(workspace.id, {
      type: "REQUESTED",
      userInitiated: true,
    });
  }

  private async settleIsolatedTurn(
    workspaceId: number,
    reservation: WritableTurnReservation,
    handle: TurnWorkspace,
    planBaseline: string | null,
  ): Promise<void> {
    try {
      const workspace = getWorkspaceById(workspaceId);
      const outcome = handle.outcome;
      if (!workspace) return;
      touchWorkspace(workspace.id);
      const appPath = getWorkspaceAppPath(workspace);
      if (!fs.existsSync(appPath)) return;
      if (isMergeInProgress(appPath)) {
        // Completed while this turn still owns the workspace; the queue
        // claims it to validate once the reservation is released below.
        await workspaceIntegrationQueue.settleMergeTurn(workspace.id, outcome);
        return;
      }
      if (!outcome.completed || outcome.stepLimitReached) return;
      const contained = await isAncestorCommit({
        path: appPath,
        ancestor: "HEAD",
        descendant: `refs/heads/${workspace.targetBranch}`,
      });
      if (!contained) {
        this.requestIntegration(workspace, outcome.messageId, false);
      } else if (workspace.integrationStatus === "resolving-conflicts") {
        // The merge was completed another way; let the queue reconcile.
        this.requestIntegration(workspace, outcome.messageId, false);
      }
    } catch (error) {
      logger.error(`Failed to settle turn for workspace ${workspaceId}`, error);
    } finally {
      const settledWorkspace = getWorkspaceById(workspaceId);
      // Resolved again: the app's folder may have moved during the turn, and
      // mirroring into its old location would recreate a stray folder there.
      const original = settledWorkspace
        ? await originalAppPathFor(settledWorkspace.appId).catch(() => null)
        : null;
      if (settledWorkspace && original && fs.existsSync(original)) {
        await mirrorMedia(getWorkspaceAppPath(settledWorkspace), original, {
          includeManifest: false,
        }).catch((error) =>
          logger.warn("Failed to mirror media back to the app", error),
        );
        await mirrorWorkingPlanBack(
          getWorkspaceAppPath(settledWorkspace),
          original,
          settledWorkspace.chatId,
          planBaseline,
        ).catch((error) =>
          logger.warn("Failed to copy the chat's plan back to the app", error),
        );
      }
      chatWorkspaceRegistry.release(reservation);
      const workspace = getWorkspaceById(workspaceId);
      if (workspace) publishWorkspaceChanged(workspace.appId);
    }
  }

  private buildHandle(
    input: PrepareTurnWorkspaceInput,
    workspace: ChatWorkspaceRow | null,
    promptNotes: string[],
    onSettle: (handle: TurnWorkspace) => Promise<void>,
  ): TurnWorkspace {
    let settled = false;
    const handle: TurnWorkspace = {
      appId: input.appId,
      chatId: input.chatId,
      kind: workspace ? "isolated" : "original",
      workspaceId: workspace?.id ?? null,
      appPath: workspace
        ? getWorkspaceAppPath(workspace)
        : input.originalAppPath,
      branch: workspace?.branch ?? null,
      targetBranch: workspace?.targetBranch ?? null,
      writable: input.writable,
      runtimeAppId: workspace ? workspaceRuntimeId(workspace.id) : input.appId,
      coordinationKey: workspace ? workspaceRuntimeId(workspace.id) : undefined,
      promptNotes,
      outcome: { completed: false, stepLimitReached: false, messageId: null },
      settle: async () => {
        if (settled) return;
        settled = true;
        await onSettle(handle);
      },
    };
    return handle;
  }

  /**
   * Reconnects an app's worktrees with its repository after the app's folder
   * was renamed or moved: a linked worktree records the repository's absolute
   * path, so Git stops working in it until repaired. The operations that move
   * app folders call this while they still hold the app's claims; it never
   * throws, since the move itself already succeeded.
   */
  async reconnectAfterAppMove(appId: number): Promise<void> {
    try {
      const workspaces = listWorkspacesForApp(appId).filter(
        (workspace) =>
          workspace.status !== "removing" && fs.existsSync(workspace.path),
      );
      if (workspaces.length === 0) return;
      const original = await originalAppPathFor(appId);
      if (!original || !fs.existsSync(original)) return;
      await repairLinkedWorktrees({
        repositoryPath: original,
        worktreePaths: workspaces.map((workspace) => workspace.path),
      });
      const repositoryRoot = await fsPromises.realpath(
        (
          await execGit(["rev-parse", "--show-toplevel"], original)
        ).stdout.trim(),
      );
      for (const workspace of workspaces) {
        const marker = await readMarker(workspace.path);
        if (marker && marker.sourceRepoPath !== repositoryRoot) {
          await writeMarker(workspace.path, {
            ...marker,
            sourceRepoPath: repositoryRoot,
          });
        }
      }
      logger.info(
        `Reconnected ${workspaces.length} workspace(s) of app ${appId}`,
      );
    } catch (error) {
      logger.error(`Failed to reconnect workspaces of app ${appId}`, error);
    }
  }

  /**
   * Repairs a workspace whose app folder was moved without
   * `reconnectAfterAppMove` (outside Dyad, or Dyad quit mid-move).
   */
  private async ensureLinked(workspace: ChatWorkspaceRow): Promise<void> {
    if (isWorktreeLinkBroken(workspace.path)) {
      await this.reconnectWithClaims(workspace.appId);
    }
  }

  private reconnectWithClaims(appId: number): Promise<void> {
    return runWorkspaceScopedOperation(
      {
        appId,
        operation: "reconnect isolated chat workspaces",
        appResources: [readAppResource("app-path")],
        workspaceResources: [],
      },
      () => this.reconnectAfterAppMove(appId),
    );
  }

  /**
   * Called after a branch of the app's repository was renamed, while the
   * rename still holds the repository claim.
   */
  onBranchRenamed({
    appId,
    oldBranch,
    newBranch,
  }: {
    appId: number;
    oldBranch: string;
    newBranch: string;
  }): void {
    if (renameBranchReferences({ appId, oldBranch, newBranch })) {
      publishWorkspaceChanged(appId);
    }
  }

  /** Path a chat's code lives in right now (its workspace or the original). */
  async resolveChatAppPath(chatId: number): Promise<string | null> {
    const workspace = getWorkspaceForChat(chatId);
    if (
      workspace?.status === "active" &&
      fs.existsSync(getWorkspaceAppPath(workspace))
    ) {
      return getWorkspaceAppPath(workspace);
    }
    const chat = await db.query.chats.findFirst({
      columns: { appId: true },
      where: eq(chats.id, chatId),
    });
    return chat ? originalAppPathFor(chat.appId) : null;
  }

  /**
   * Stops a workspace's preview (if running) and drops its runtime actor,
   * logs, and claims. Worktree retention and runtime retention are separate:
   * an idle preview can be stopped while its worktree is kept.
   */
  private async disposeWorkspaceRuntime(workspaceId: number): Promise<void> {
    const runtimeId = workspaceRuntimeId(workspaceId);
    const running = runningApps.get(runtimeId);
    if (running) {
      await stopAppByInfo(runtimeId, running).catch((error) =>
        logger.warn(`Failed to stop workspace runtime ${runtimeId}`, error),
      );
    }
    await appRunActorService
      .disposeApp(runtimeId)
      .catch((error) =>
        logger.warn(`Failed to dispose workspace runtime ${runtimeId}`, error),
      );
    appRuntimeService.clearRuntimeLogs(runtimeId);
    appRuntimeService.cleanup(runtimeId);
  }

  /* Retention ------------------------------------------------------------ */

  /**
   * Why a workspace cannot be removed right now, or null when it can. Removal
   * requires no turn, reader, or preview; no pending integration or Git
   * operation; no uncommitted work; and every commit integrated.
   */
  async removalBlocker(
    workspace: ChatWorkspaceRow,
    { ignoreRegistry = false }: { ignoreRegistry?: boolean } = {},
  ): Promise<string | null> {
    if (workspace.status !== "active") return "not active";
    if (
      !ignoreRegistry &&
      chatWorkspaceRegistry.isWorkspaceBusy(workspace.id)
    ) {
      return "in use";
    }
    if (runningApps.has(workspaceRuntimeId(workspace.id))) {
      return "preview running";
    }
    const phase: IntegrationPhase = workspace.integrationStatus;
    if (phase !== "idle" && phase !== "merged") return `integration ${phase}`;
    const appPath = getWorkspaceAppPath(workspace);
    if (!fs.existsSync(appPath)) return null;
    const health = await inspectRepositoryHealth({ path: appPath });
    if (health.operationInProgress) return health.operationInProgress;
    const status = await execGit(
      ["status", "--porcelain", "--untracked-files=all"],
      appPath,
    );
    if (status.exitCode !== 0 || status.stdout.trim().length > 0) {
      return "uncommitted work";
    }
    const integrated = await isAncestorCommit({
      path: appPath,
      ancestor: "HEAD",
      descendant: `refs/heads/${workspace.targetBranch}`,
    });
    return integrated ? null : "unintegrated commits";
  }

  /**
   * Removes the least recently active eligible workspaces until the app is
   * within capacity (plus `needSlots`), and every eligible workspace idle for
   * longer than the inactivity limit.
   */
  async sweepApp(
    appId: number,
    { needSlots = 0 }: { needSlots?: number } = {},
  ): Promise<number> {
    const { maxWorkspaces, idleHours } = getWorktreeIsolationLimits();
    const workspaces = listWorkspacesForApp(appId)
      .filter((workspace) => workspace.status === "active")
      .sort((a, b) => a.lastActiveAt.getTime() - b.lastActiveAt.getTime());
    let excess = workspaces.length + needSlots - maxWorkspaces;
    const idleCutoff = Date.now() - idleHours * 60 * 60 * 1000;
    let removed = 0;
    for (const workspace of workspaces) {
      const idle = workspace.lastActiveAt.getTime() < idleCutoff;
      if (excess <= 0 && !idle) continue;
      const blocker = await this.removalBlocker(workspace).catch(
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
      if (blocker) continue;
      try {
        await this.removeWorkspace(workspace.id);
        removed++;
        excess--;
      } catch (error) {
        logger.warn(`Failed to remove workspace ${workspace.id}`, error);
      }
    }
    return removed;
  }

  async sweepAll(): Promise<void> {
    const appIds = new Set(listAllWorkspaces().map((row) => row.appId));
    for (const appId of appIds) {
      await this.sweepApp(appId).catch((error) =>
        logger.warn(`Workspace sweep failed for app ${appId}`, error),
      );
    }
  }

  /**
   * Deletes a workspace's worktree and row. Its branch is deleted only when
   * Git confirms it is fully merged, so unintegrated commits stay reachable.
   * Chat messages and integration history are untouched.
   */
  async removeWorkspace(
    workspaceId: number,
    { force = false }: { force?: boolean } = {},
  ): Promise<void> {
    const workspace = getWorkspaceById(workspaceId);
    if (!workspace) return;
    let releaseClaim = chatWorkspaceRegistry.tryClaimWorkspaceForRemoval(
      workspace.appId,
      workspace.id,
    );
    if (!force) {
      if (!releaseClaim) {
        throw new DyadError(
          "This workspace can't be removed yet (in use)",
          DyadErrorKind.Precondition,
        );
      }
      // Re-check under the claim: nothing can start using it now.
      const blocker = await this.removalBlocker(workspace, {
        ignoreRegistry: true,
      });
      if (blocker) {
        releaseClaim();
        throw new DyadError(
          `This workspace can't be removed yet (${blocker})`,
          DyadErrorKind.Precondition,
        );
      }
    } else {
      // A forced removal (its chat is being deleted) waits briefly for an
      // integration step to let go, then proceeds.
      const deadline = Date.now() + FORCED_REMOVAL_WAIT_MS;
      while (!releaseClaim && Date.now() < deadline) {
        workspaceIntegrationQueue.forget(workspace.appId, workspace.id);
        await Promise.race([
          chatWorkspaceRegistry.waitForChange(),
          new Promise((resolve) => setTimeout(resolve, 1_000)),
        ]);
        releaseClaim = chatWorkspaceRegistry.tryClaimWorkspaceForRemoval(
          workspace.appId,
          workspace.id,
        );
      }
    }
    try {
      await this.removeClaimedWorkspace(workspace);
    } finally {
      releaseClaim?.();
    }
  }

  private async removeClaimedWorkspace(
    workspace: ChatWorkspaceRow,
  ): Promise<void> {
    updateWorkspace(workspace.id, { status: "removing" });
    workspaceIntegrationQueue.forget(workspace.appId, workspace.id);
    await this.disposeWorkspaceRuntime(workspace.id);
    const original = await originalAppPathFor(workspace.appId);
    const marker = await readMarker(workspace.path);
    const repositoryPath = original ?? marker?.sourceRepoPath;
    await runWorkspaceScopedOperation(
      {
        appId: workspace.appId,
        workspaceKey: workspaceRuntimeId(workspace.id),
        operation: "remove isolated chat workspace",
        appResources: original ? [readAppResource("app-path")] : [],
        workspaceResources: ["repository", "runtime"],
      },
      async () => {
        if (repositoryPath && fs.existsSync(repositoryPath)) {
          await removeLinkedWorktree({
            repositoryPath,
            worktreePath: workspace.path,
          });
          await deleteMergedBranch({
            repositoryPath,
            branch: workspace.branch,
          });
        } else {
          await fsPromises.rm(workspace.path, { recursive: true, force: true });
        }
        await fsPromises.rm(markerPath(workspace.path), { force: true });
      },
    );
    deleteWorkspaceRow(workspace.id);
    logger.info(`Removed isolated workspace ${workspace.path}`);
    publishWorkspaceChanged(workspace.appId);
  }

  /**
   * Called before a chat is deleted: its workspace goes with it. Unmerged
   * commits stay reachable on the branch because only merged branches are
   * deleted.
   */
  async onChatDeleting(chatId: number): Promise<void> {
    const workspace = getWorkspaceForChat(chatId);
    if (!workspace) return;
    await this.removeWorkspace(workspace.id, { force: true }).catch((error) =>
      logger.warn(
        `Failed to remove workspace of deleted chat ${chatId}`,
        error,
      ),
    );
  }

  /**
   * Stops an app's workspace previews while the app is being deleted. Called
   * with the rows captured before the app row (and, by cascade, these rows)
   * is deleted.
   */
  async stopRuntimesForDeletedApp(
    workspaces: readonly ChatWorkspaceRow[],
  ): Promise<void> {
    for (const workspace of workspaces) {
      workspaceIntegrationQueue.forget(workspace.appId, workspace.id);
      const runtimeId = workspaceRuntimeId(workspace.id);
      const running = runningApps.get(runtimeId);
      if (running) {
        await stopAppByInfo(runtimeId, running).catch((error) =>
          logger.warn(`Failed to stop workspace runtime ${runtimeId}`, error),
        );
      }
    }
  }

  /** Disposes runtimes and deletes worktree folders after app deletion. */
  async cleanUpAfterAppDeletion(
    workspaces: readonly ChatWorkspaceRow[],
  ): Promise<void> {
    for (const workspace of workspaces) {
      await this.disposeWorkspaceRuntime(workspace.id);
      await fsPromises
        .rm(workspace.path, { recursive: true, force: true })
        .catch(() => undefined);
      await fsPromises
        .rm(markerPath(workspace.path), { force: true })
        .catch(() => undefined);
    }
  }

  /* Startup ------------------------------------------------------------- */

  /**
   * Reconciles persisted workspace state with Git after a restart. Recovery
   * inspects the actual repository before retrying anything: an integration
   * that finished before its status was saved is recorded as merged, an
   * unfinished merge is kept for the user, and queued work resumes.
   */
  async recover(): Promise<void> {
    const brokenApps = new Set(
      listAllWorkspaces()
        .filter(
          (workspace) =>
            workspace.status === "active" &&
            isWorktreeLinkBroken(workspace.path),
        )
        .map((workspace) => workspace.appId),
    );
    for (const appId of brokenApps) {
      await this.reconnectWithClaims(appId).catch((error) =>
        logger.error(`Failed to reconnect workspaces of app ${appId}`, error),
      );
    }
    for (const workspace of listAllWorkspaces()) {
      try {
        await this.recoverWorkspace(workspace);
      } catch (error) {
        logger.error(`Failed to recover workspace ${workspace.id}`, error);
      }
    }
    await this.removeOrphanedDirectories();
    workspaceIntegrationQueue.start();
    workspaceIntegrationQueue.resumePending();
    if (!this.sweepTimer) {
      this.sweepTimer = setInterval(() => {
        void this.sweepAll();
      }, SWEEP_INTERVAL_MS);
      this.sweepTimer.unref?.();
    }
    void this.sweepAll();
  }

  private async recoverWorkspace(workspace: ChatWorkspaceRow): Promise<void> {
    if (workspace.status === "creating" || workspace.status === "removing") {
      const original = await originalAppPathFor(workspace.appId);
      if (original) {
        await removeLinkedWorktree({
          repositoryPath: original,
          worktreePath: workspace.path,
        }).catch(() => undefined);
        if (workspace.status === "creating") {
          await deleteMergedBranch({
            repositoryPath: original,
            branch: workspace.branch,
          }).catch(() => undefined);
        }
      }
      await fsPromises
        .rm(markerPath(workspace.path), { force: true })
        .catch(() => undefined);
      deleteWorkspaceRow(workspace.id);
      return;
    }
    const appPath = getWorkspaceAppPath(workspace);
    if (!fs.existsSync(appPath)) return;
    const phase = workspace.integrationStatus;
    const original = await originalAppPathFor(workspace.appId);
    if (!original) return;
    const targetRef = `refs/heads/${workspace.targetBranch}`;
    const integrated = await isAncestorCommit({
      path: appPath,
      ancestor: "HEAD",
      descendant: targetRef,
    }).catch(() => false);
    switch (phase) {
      case "integrating":
      case "validating":
      case "merging":
      case "queued": {
        if (phase === "integrating" && integrated) {
          // The fast-forward landed before its status was saved.
          const head = await getCurrentCommitHash({ path: appPath });
          updateWorkspace(workspace.id, {
            integrationStatus: "merged",
            integrationDetail: null,
            integrationTargetCommit: null,
            repairAttempts: 0,
            lastIntegratedCommit: head,
          });
          return;
        }
        if (isMergeInProgress(appPath)) {
          const conflicts = await gitGetMergeConflicts({ path: appPath });
          if (conflicts.length > 0) {
            updateWorkspace(workspace.id, {
              integrationStatus: "paused",
              integrationDetail:
                "Dyad restarted while combining this chat's work. Send a message in this chat to finish resolving the conflicts.",
            });
            return;
          }
        }
        // Merging, validating, and integrating are all safe to redo from the
        // persisted phase; the queue resumes them.
        return;
      }
      case "resolving-conflicts":
        updateWorkspace(workspace.id, {
          integrationStatus: "paused",
          integrationDetail:
            "Dyad restarted while this chat was resolving conflicts. Send a message in this chat to continue.",
        });
        return;
      case "idle":
      case "merged":
      case "paused":
      case "failed":
        return;
      default: {
        const unreachable: never = phase;
        throw new Error(`Unhandled phase ${String(unreachable)}`);
      }
    }
  }

  /** Deletes Dyad-owned worktree folders whose workspace row is gone. */
  private async removeOrphanedDirectories(): Promise<void> {
    const root = getChatWorkspacesRoot();
    let appDirectories: fs.Dirent[];
    try {
      appDirectories = await fsPromises.readdir(root, { withFileTypes: true });
    } catch {
      return;
    }
    const known = new Set(listAllWorkspaces().map((row) => row.path));
    for (const appDirectory of appDirectories) {
      if (!appDirectory.isDirectory()) continue;
      const appRoot = path.join(root, appDirectory.name);
      const entries = await fsPromises
        .readdir(appRoot, { withFileTypes: true })
        .catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const worktreeRoot = path.join(appRoot, entry.name);
        if (known.has(worktreeRoot)) continue;
        // Only folders carrying Dyad's ownership marker are ever deleted.
        const marker = await readMarker(worktreeRoot);
        if (!marker) continue;
        if (fs.existsSync(marker.sourceRepoPath)) {
          await removeLinkedWorktree({
            repositoryPath: marker.sourceRepoPath,
            worktreePath: worktreeRoot,
          }).catch(() => undefined);
          await deleteMergedBranch({
            repositoryPath: marker.sourceRepoPath,
            branch: marker.branch,
          }).catch(() => undefined);
        } else {
          await fsPromises
            .rm(worktreeRoot, { recursive: true, force: true })
            .catch(() => undefined);
        }
        await fsPromises
          .rm(markerPath(worktreeRoot), { force: true })
          .catch(() => undefined);
      }
    }
  }
}

export const chatWorkspaceService = new ChatWorkspaceService();
