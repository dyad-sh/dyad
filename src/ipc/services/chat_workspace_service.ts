import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chats } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import {
  execGit,
  getCurrentCommitHash,
  gitCurrentBranch,
  inspectRepositoryHealth,
  type RepositoryHealth,
} from "@/ipc/utils/git_utils";
import {
  addBranchWorktree,
  isLinkedWorktreeOf,
  checkoutBranchWorktree,
  deleteMergedBranch,
  forceDeleteBranch,
  haveSameTree,
  excludeDyadMetadata,
  gitBranchExists,
  isAncestorCommit,
  isMergeInProgress,
  isWorktreeLinkBroken,
  listChangedPaths,
  listPathsChangedByOwnCommits,
  listUncommittedPaths,
  mergeIntoWorkspace,
  pruneGitWorktrees,
  readMergeConflicts,
  removeLinkedWorktree,
  repairLinkedWorktrees,
  restoreMissingTrackedFiles,
} from "@/ipc/utils/git_worktree_utils";
import { runningApps, stopAppByInfo } from "@/ipc/utils/process_manager";
import { appRunActorService } from "./app_run_actor_service";
import { appRuntimeService } from "./app_runtime_service";
import {
  ATTACHMENTS_MANIFEST_FILE,
  getDyadMediaDir,
} from "@/ipc/utils/media_path_utils";
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
  getOriginalAppPath,
  getChatWorkspacesRoot,
  getWorkspaceAppPath,
  getWorkspaceById,
  getWorkspaceForChat,
  insertWorkspace,
  isWorkspaceIntegrated,
  toAppRelativePath,
  listAllWorkspaces,
  listWorkspacesForApp,
  renameBranchReferences,
  updateWorkspace,
  type ChatWorkspaceRow,
} from "./chat_workspace_store";
import { publishWorkspaceChanged } from "./workspace_events";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import {
  recordIntegratedSquash,
  workspaceIntegrationQueue,
} from "./workspace_integration_queue";
import { resolvePackageManager } from "./isolated_package_install";
import { syncEnvironmentFiles } from "./workspace_environment";
import {
  appUsesSupabase,
  findSupabaseFunctionChanges,
  resyncSupabaseFunctionsFromApp,
  type SupabaseFunctionChanges,
} from "./workspace_supabase_sync";
import { WORKTREE_BRANCH_PREFIX } from "@/shared/dyad_commit_trailers";
import { runWorkspaceScopedOperation } from "./workspace_coordination";

const logger = log.scope("chat_workspace_service");

const FAILED_REMOVAL_DETAIL =
  "Dyad could not finish deleting this worktree. Its remaining files and branch have been kept. Check the folder permissions, then choose Delete worktree again.";
const INCOMPLETE_WORKTREE_DETAIL =
  "Dyad could not verify this worktree. Inspect its remaining files before choosing Delete worktree.";

function markWorkspaceUnavailable(workspace: ChatWorkspaceRow, detail: string) {
  updateWorkspace(workspace.id, {
    status: "unavailable",
    integrationStatus: "failed",
    integrationDetail: detail,
  });
  publishWorkspaceChanged(workspace.appId);
}

function getTurnWorkspaceRow(chatId: number) {
  const workspace = getWorkspaceForChat(chatId);
  if (workspace?.status === "unavailable") {
    throw new DyadError(
      workspace.integrationDetail ?? INCOMPLETE_WORKTREE_DETAIL,
      DyadErrorKind.Precondition,
    );
  }
  return workspace;
}

const MARKER_SCHEMA = "dyad-chat-workspace-v1";
const BRANCH_RECHECK_MS = 30_000;
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
  /** Excludes an image already saved in the app library from settlement. */
  onMediaSavedToApp?: (fileName: string) => void;
  /** Filled in by the turn before it settles. */
  readonly outcome: {
    completed: boolean;
    stepLimitReached: boolean;
  };
  /** Runs the settlement hook once and releases the workspace. */
  settle(): Promise<void>;
}

export interface PrepareTurnWorkspaceInput {
  appId: number;
  chatId: number;
  originalAppPath: string;
  writable: boolean;
  /**
   * Whether this turn may create a worktree when isolation is enabled.
   */
  allowIsolation: boolean;
  /**
   * False when applying changes already generated against the workspace's
   * current code (approving a proposal): merging newer target work in first
   * would let those changes overwrite it. Defaults to true.
   */
  synchronize?: boolean;
  /**
   * When set, the message to refuse with (releasing the reservation) if the
   * chat's workspace has a merge in progress once it is reserved. Approving
   * a proposal must not write into a conflict resolution; a turn instead
   * resolves it.
   */
  refuseWhileMerging?: string;
  signal: AbortSignal;
  /** Reports why the turn is waiting, or null when it stops waiting. */
  onWaiting?: (message: string | null) => void;
}

export function isWorktreeIsolationEnabled(): boolean {
  return readSettings().enableWorktreeIsolation === true;
}

function markerPath(worktreeRoot: string): string {
  return `${worktreeRoot}.owner.json`;
}

/**
 * The edge functions a worktree's unmerged work touched: its own commits
 * since the last integration (each on its own, so one an Undo reverted
 * still counts: its version was deployed) and every uncommitted change.
 * A turn deploys a function the moment it writes it, so these may be live
 * in the worktree's version. Null when the app has no Supabase project, or
 * when Git cannot tell (logged).
 */
async function unmergedSupabaseFunctionChanges(
  workspace: ChatWorkspaceRow,
): Promise<SupabaseFunctionChanges | null> {
  try {
    if (!(await appUsesSupabase(workspace.appId))) return null;
    const appPath = getWorkspaceAppPath(workspace);
    const [ownCommits, sinceIntegration, uncommitted] = await Promise.all([
      listPathsChangedByOwnCommits({
        path: appPath,
        from: workspace.lastIntegratedCommit,
        to: "HEAD",
      }),
      // Also merge resolutions and anything a merge commit carries.
      listChangedPaths({
        path: workspace.path,
        from: workspace.lastIntegratedCommit,
      }),
      listUncommittedPaths(workspace.path),
    ]);
    return findSupabaseFunctionChanges([
      ...ownCommits,
      ...[...sinceIntegration, ...uncommitted].map((file) =>
        toAppRelativePath(workspace, file),
      ),
    ]);
  } catch (error) {
    logger.warn(
      `Failed to find the Supabase functions workspace ${workspace.id} changed`,
      error,
    );
    return null;
  }
}

/**
 * Drops a worktree's ownership marker once its folder is gone. While the
 * folder survives, the marker is what lets the startup orphan sweep find
 * and remove it: only marked folders are ever deleted.
 */
async function removeMarkerIfFolderGone(worktreeRoot: string): Promise<void> {
  if (fs.existsSync(worktreeRoot)) return;
  await fsPromises
    .rm(markerPath(worktreeRoot), { force: true })
    .catch(() => undefined);
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

/**
 * The package manager this worktree's installs will use, the same way
 * validation and its preview pick one. Each npm worktree gets a full copy of
 * its dependencies, which is what the chat warns about.
 */
export async function getWorkspacePackageManager(
  workspace: Pick<ChatWorkspaceRow, "path" | "appSubpath">,
): Promise<"npm" | "pnpm" | null> {
  const appPath = getWorkspaceAppPath(workspace);
  try {
    return (await resolvePackageManager(appPath, workspace.path))
      .packageManager;
  } catch (error) {
    logger.warn(`Could not detect the package manager for ${appPath}`, error);
    return null;
  }
}

/**
 * `dyad/chat-<id>`, or the first `-<n>` suffix no branch uses yet: a deleted
 * workspace's unmerged branch is kept, so a chat can retain any number of
 * them.
 */
async function uniqueBranchName(
  repositoryPath: string,
  chatId: number,
): Promise<string> {
  const base = `${WORKTREE_BRANCH_PREFIX}${chatId}`;
  const result = await execGit(
    [
      "for-each-ref",
      "--format=%(refname:lstrip=2)",
      `refs/heads/${base}`,
      `refs/heads/${base}-*`,
    ],
    repositoryPath,
  );
  if (result.exitCode !== 0) {
    throw new DyadError(
      `Could not list branches to name the isolated workspace: ${result.stderr.trim()}`,
      DyadErrorKind.External,
    );
  }
  const taken = new Set(
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
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
  {
    includeManifest,
    skip,
  }: {
    includeManifest: boolean;
    /** File names never to copy (those that were there before the turn). */
    skip?: ReadonlySet<string>;
  },
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
    if (skip?.has(entry.name)) continue;
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
 *
 * A plan that fails to copy is logged and skipped rather than failing the
 * turn. When that plan is the working plan, the workspace may hold a stale
 * copy, so settlement must not copy it back over the app's newer one
 * (`copyWorkingPlanBack: false`).
 */
async function mirrorChatPlansIn(
  fromAppPath: string,
  toAppPath: string,
  chatId: number,
): Promise<{ planBaseline: string | null; copyWorkingPlanBack: boolean }> {
  const slug = planSlugForChat(chatId);
  const workingPlanName = `${slug}.md`;
  const fromDir = planDirForAppPath(fromAppPath);
  let names: string[];
  try {
    names = (await fsPromises.readdir(fromDir)).filter(
      (name) =>
        name === workingPlanName ||
        (name.startsWith(`${slug}-`) && name.endsWith(".md")),
    );
  } catch {
    return { planBaseline: null, copyWorkingPlanBack: true };
  }
  if (names.length === 0) {
    return { planBaseline: null, copyWorkingPlanBack: true };
  }
  const toDir = planDirForAppPath(toAppPath);
  await fsPromises.mkdir(toDir, { recursive: true });
  let copyWorkingPlanBack = true;
  for (const name of names) {
    try {
      await fsPromises.copyFile(
        path.join(fromDir, name),
        path.join(toDir, name),
      );
    } catch (error) {
      logger.warn(`Failed to mirror plan ${name} into the workspace`, error);
      if (name === workingPlanName) copyWorkingPlanBack = false;
    }
  }
  return {
    planBaseline: await fsPromises
      .readFile(path.join(toDir, workingPlanName), "utf8")
      .catch(() => null),
    copyWorkingPlanBack,
  };
}

/**
 * Copies the chat's pre-compaction transcript backups (`.dyad/chats/<id>/`)
 * into a workspace, so a compaction summary that points at one still
 * resolves in a worktree created after it.
 */
async function mirrorChatBackupsIn(
  fromAppPath: string,
  toAppPath: string,
  chatId: number,
): Promise<void> {
  const relativeDir = path.join(".dyad", "chats", String(chatId));
  const fromDir = path.join(fromAppPath, relativeDir);
  let names: string[];
  try {
    names = await fsPromises.readdir(fromDir);
  } catch {
    return;
  }
  const toDir = path.join(toAppPath, relativeDir);
  await fsPromises.mkdir(toDir, { recursive: true });
  for (const name of names) {
    const destination = path.join(toDir, name);
    if (fs.existsSync(destination)) continue;
    await fsPromises
      .copyFile(path.join(fromDir, name), destination)
      .catch((error) =>
        logger.warn(`Failed to mirror ${name} into the workspace`, error),
      );
  }
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

/** What a turn's settlement compares against to copy back only its own changes. */
interface MirroredState {
  planBaseline: string | null;
  /** False when the working plan could not be copied in. */
  copyWorkingPlanBack: boolean;
  mediaBaseline: Set<string>;
}

/** Copies the app's media and the chat's plans into its workspace. */
async function mirrorIntoWorkspace(
  originalAppPath: string,
  workspace: ChatWorkspaceRow,
  chatId: number,
): Promise<MirroredState> {
  await excludeDyadMetadata(workspace.path);
  const workspaceAppPath = getWorkspaceAppPath(workspace);
  await mirrorMedia(originalAppPath, workspaceAppPath, {
    includeManifest: true,
  });
  await mirrorChatBackupsIn(originalAppPath, workspaceAppPath, chatId);
  // Media already here is not the turn's to copy back: the user may delete,
  // rename, or move it in the app's media library meanwhile.
  const mediaBaseline = new Set(
    await fsPromises
      .readdir(getDyadMediaDir(workspaceAppPath))
      .catch(() => [] as string[]),
  );
  return {
    mediaBaseline,
    ...(await mirrorChatPlansIn(originalAppPath, workspaceAppPath, chatId)),
  };
}

/**
 * `input` with the app's folder read again from its row: the caller's path
 * is a snapshot, and the app can be renamed or moved while a turn waits.
 */
async function withCurrentOriginalAppPath(
  input: PrepareTurnWorkspaceInput,
): Promise<PrepareTurnWorkspaceInput> {
  const originalAppPath = await getOriginalAppPath(input.appId);
  return originalAppPath && originalAppPath !== input.originalAppPath
    ? { ...input, originalAppPath }
    : input;
}

class ChatWorkspaceService {
  /**
   * Chooses where a turn runs. Writable turns reserve their placement for the
   * whole turn; `settle()` must be called exactly once, in `finally`.
   */
  async prepareTurnWorkspace(
    input: PrepareTurnWorkspaceInput,
  ): Promise<TurnWorkspace> {
    // Startup recovery deletes interrupted "creating" rows and sweeps orphan
    // folders; a workspace created while it runs could be swept with them.
    await this.waitForRecovery();
    input = await withCurrentOriginalAppPath(input);
    return input.writable
      ? this.prepareWritableTurn(input)
      : this.prepareReadOnlyTurn(input);
  }

  private async prepareReadOnlyTurn(
    input: PrepareTurnWorkspaceInput,
  ): Promise<TurnWorkspace> {
    const workspace = getTurnWorkspaceRow(input.chatId);
    if (workspace?.status !== "active") {
      return this.buildHandle(input, null, [], async () => undefined);
    }
    // Ask and Plan read the chat's workspace as it is: no worktree is created
    // and nothing is synchronized or integrated.
    const releaseReader = chatWorkspaceRegistry.tryAddReader(
      input.appId,
      workspace.id,
    );
    if (!releaseReader) {
      // The workspace is being removed. Read the app's folder instead: it
      // has the chat's merged work, though not work the user chose to
      // delete unmerged.
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
        const existing = getTurnWorkspaceRow(chatId);
        if (existing && existing.status !== "active") {
          // The chat's previous workspace is still being cleaned up (or set
          // up by an interrupted attempt); a chat has one workspace at most.
          setWaiting(
            "Waiting for this chat's previous workspace to be cleaned up…",
          );
          await chatWorkspaceRegistry.waitForChange(signal, {
            timeoutMs: 2_000,
          });
          continue;
        }
        const usableExisting = existing;
        const decision = chatWorkspaceRegistry.reserveWritableTurn({
          appId,
          chatId,
          existingWorkspaceId: usableExisting?.id ?? null,
          isolationEnabled:
            isWorktreeIsolationEnabled() && input.allowIsolation,
        });
        if (decision.kind !== "wait") {
          // The app's folder may have moved while this waited.
          input = await withCurrentOriginalAppPath(input).catch((error) => {
            chatWorkspaceRegistry.release(decision.reservation);
            throw error;
          });
        }
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
              // Checked under the reservation: a merge may have started (and
              // hit conflicts) while this waited for the workspace.
              if (
                input.refuseWhileMerging &&
                isMergeInProgress(getWorkspaceAppPath(workspace))
              ) {
                throw new DyadError(
                  input.refuseWhileMerging,
                  DyadErrorKind.Precondition,
                );
              }
              // Settings changed in the app since the last turn reach the
              // worktree too.
              await syncEnvironmentFiles(
                input.originalAppPath,
                getWorkspaceAppPath(workspace),
              );
              const notes = await this.prepareExistingWorkspace(workspace, {
                synchronize: input.synchronize !== false,
              });
              const mirrored = await mirrorIntoWorkspace(
                input.originalAppPath,
                workspace,
                chatId,
              );
              return this.buildHandle(
                input,
                workspace,
                notes,
                (handle) =>
                  this.settleIsolatedTurn(
                    workspace.id,
                    reservation,
                    handle,
                    mirrored,
                  ),
                mirrored.mediaBaseline,
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
                `This chat works in its own isolated workspace on branch \`${created.branch}\`, created from the latest committed \`${created.targetBranch}\`, so other chats can change this app at the same time. Uncommitted changes in the app's folder are not here. Dyad merges this chat's finished work into \`${created.targetBranch}\` after checking the combined code.`,
              ],
              (handle) =>
                this.settleIsolatedTurn(
                  created.id,
                  reservation,
                  handle,
                  mirrored,
                ),
              mirrored.mediaBaseline,
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
   * (and explaining why) while the app is not on a branch. There is no limit
   * on how many workspaces an app has; the user deletes them per chat.
   */
  private async createForReservation(
    input: PrepareTurnWorkspaceInput,
    reservation: WritableTurnReservation,
    setWaiting: (message: string | null) => void,
  ): Promise<ChatWorkspaceRow> {
    const { appId, chatId, signal } = input;
    try {
      while (true) {
        signal.throwIfAborted();
        const workspace = await this.createWorkspace({ appId, chatId });
        if (workspace) {
          setWaiting(null);
          chatWorkspaceRegistry.bindWorkspace(reservation, workspace.id);
          return workspace;
        }
        setWaiting(
          "Waiting for the app to return to a branch: it is showing an earlier version, so there is no branch to start isolated work from.",
        );
        await chatWorkspaceRegistry.waitForChange(signal, {
          timeoutMs: BRANCH_RECHECK_MS,
        });
      }
    } catch (error) {
      chatWorkspaceRegistry.release(reservation);
      throw error;
    }
  }

  /**
   * Creates a workspace from the branch the app's folder is on, or returns
   * null while it is on none. Both are read under the operation's claims, so
   * a branch switch or a move cannot land between reading and creating.
   */
  private async createWorkspace({
    appId,
    chatId,
  }: {
    appId: number;
    chatId: number;
  }): Promise<ChatWorkspaceRow | null> {
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
        const originalAppPath = await getOriginalAppPath(appId);
        if (!originalAppPath) {
          throw new DyadError("App not found", DyadErrorKind.NotFound);
        }
        const targetBranch = await gitCurrentBranch({ path: originalAppPath });
        if (!targetBranch) return null;
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
          lastIntegratedCommit: baseCommit,
        });
        try {
          await addBranchWorktree({
            repositoryPath: originalAppPath,
            worktreePath: worktreeRoot,
            branch,
            startPoint: baseCommit,
          });
          await syncEnvironmentFiles(originalAppPath, getWorkspaceAppPath(row));
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
          // A folder that survived is swept as an orphan at the next startup.
          await removeMarkerIfFolderGone(worktreeRoot);
          deleteWorkspaceRow(row.id);
          throw error;
        }
        logger.info(
          `Created isolated workspace ${worktreeRoot} on ${branch} for chat ${chatId}`,
        );
        const created = getWorkspaceById(row.id)!;
        sendTelemetryEvent("workspace:created", {
          liveWorkspaces: listWorkspacesForApp(appId).length,
          packageManager:
            (await getWorkspacePackageManager(created)) ?? "unknown",
        });
        publishWorkspaceChanged(appId);
        return created;
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
    if (fs.existsSync(workspace.path)) {
      await this.ensureLinked(workspace);
      const original = await getOriginalAppPath(workspace.appId);
      if (
        !original ||
        !isLinkedWorktreeOf(workspace.path, original) ||
        !fs.existsSync(getWorkspaceAppPath(workspace))
      ) {
        markWorkspaceUnavailable(workspace, INCOMPLETE_WORKTREE_DETAIL);
        throw new DyadError(
          INCOMPLETE_WORKTREE_DETAIL,
          DyadErrorKind.Precondition,
        );
      }
      return workspace;
    }
    const original = await getOriginalAppPath(workspace.appId);
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
    await checkoutBranchWorktree({
      repositoryPath: original,
      worktreePath: workspace.path,
      branch: workspace.branch,
    });
    await syncEnvironmentFiles(original, getWorkspaceAppPath(workspace));
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
    await this.reconcileIntegration(workspace, health);
    if (
      health.branch !== workspace.branch &&
      !(health.branch === null && health.operationInProgress === "rebase")
    ) {
      throw new DyadError(
        `Switch this worktree back to ${workspace.branch} before continuing.`,
        DyadErrorKind.Precondition,
      );
    }
    if (health.operationInProgress === "merge") {
      const conflicts = await readMergeConflicts(appPath);
      return [
        `A merge of \`${workspace.targetBranch}\` into this chat's workspace is in progress so this chat's earlier work can be integrated.${conflicts.length > 0 ? ` These files still conflict: ${conflicts.map((file) => toAppRelativePath(workspace, file)).join(", ")}.` : ""} Before starting anything new, finish resolving it: edit each conflicted file so both this chat's task and the changes from \`${workspace.targetBranch}\` keep working, and remove every conflict marker. Do not commit or abort the merge; Dyad completes and checks it after this turn.`,
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
    if (health.headOid !== workspace.lastIntegratedCommit) {
      // Earlier work that never reached the target (queued, paused, failed,
      // or undone) is preserved; this turn's completion requests integration
      // for all of it together.
      return [
        `This chat's earlier work is not merged into \`${workspace.targetBranch}\` yet${workspace.integrationDetail ? ` (${workspace.integrationDetail})` : ""}. It is preserved in this workspace; Dyad merges it together with this turn's changes.`,
      ];
    }
    if (!synchronize) return [];
    // Clean and fully integrated: bring in what other chats merged since.
    const result = await this.synchronizeWithTarget(workspace);
    if (result.kind === "failed") {
      return [
        `Dyad couldn't update this workspace with the latest \`${workspace.targetBranch}\` before this turn, so recent work from other chats may be missing here. It will be combined when this chat's work is merged.`,
      ];
    }
    if (result.kind === "unchanged") return [];
    const { changed } = result;
    return [
      `Since this chat's last turn, other work was merged into \`${workspace.targetBranch}\` and this workspace was updated to include it (${changed.length} file${changed.length === 1 ? "" : "s"} changed${
        changed.length > 0
          ? `: ${changed
              .slice(0, 30)
              .map((file) => toAppRelativePath(workspace, file))
              .join(", ")}${changed.length > 30 ? ", …" : ""}`
          : ""
      }). Your earlier view of these files may be out of date: read the current version of any file before editing it.`,
    ];
  }

  /**
   * Merges the target into a clean, fully integrated workspace (normally a
   * fast-forward). Callers own the workspace: a turn reservation or an
   * exclusive registry claim. The workspace stays integrated, so its new HEAD
   * becomes the integrated head.
   */
  private async synchronizeWithTarget(
    workspace: ChatWorkspaceRow,
  ): Promise<
    | { kind: "unchanged" }
    | { kind: "updated"; changed: string[] }
    | { kind: "failed" }
  > {
    const appPath = getWorkspaceAppPath(workspace);
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
            ref: `refs/heads/${workspace.targetBranch}`,
            allowFastForward: true,
            message: `Synchronize ${workspace.branch} with ${workspace.targetBranch}\n\nDyad-Chat: ${workspace.chatId}\nDyad-Workspace: ${workspace.branch}`,
          }),
      );
    } catch (error) {
      logger.warn(`Failed to synchronize workspace ${workspace.id}`, error);
      return { kind: "failed" };
    }
    if (result.kind === "up-to-date") return { kind: "unchanged" };
    if (result.kind === "conflicts") {
      // Only reachable when recording an earlier squash failed. Never leave
      // a half-merged tree behind a sync; the turn is told it may be behind,
      // and integration resolves the conflict as usual.
      await execGit(["merge", "--abort"], appPath);
      return { kind: "failed" };
    }
    const changed = await listChangedPaths({
      path: appPath,
      from: before,
      to: "HEAD",
    });
    updateWorkspace(workspace.id, {
      lastIntegratedCommit: await getCurrentCommitHash({ path: appPath }),
    });
    publishWorkspaceChanged(workspace.appId);
    return { kind: "updated", changed };
  }

  /**
   * Brings a chat's idle, clean, fully merged workspace up to date with its
   * target outside a turn, for app-level changes the chat should see before
   * its next turn (applying a template replaces the code it previews).
   * Returns the workspace's runtime id when its code changed, or null when
   * there was nothing to do, or the workspace is in use or holds unmerged
   * work (its next turn synchronizes it instead).
   */
  async synchronizeIdleWorkspace(chatId: number): Promise<number | null> {
    await this.waitForRecovery();
    const workspace = getActiveWorkspaceForChat(chatId);
    if (!workspace) return null;
    // Exclusive like an integration step: turns, the queue, and removal wait.
    const release = chatWorkspaceRegistry.tryClaimWorkspaceForIntegration(
      workspace.appId,
      workspace.id,
    );
    if (!release) return null;
    try {
      await this.ensureLinked(workspace);
      const appPath = getWorkspaceAppPath(workspace);
      const health = await inspectRepositoryHealth({ path: appPath });
      if (health.operationInProgress || !health.isClean) return null;
      if (!(await isWorkspaceIntegrated(workspace))) return null;
      const result = await this.synchronizeWithTarget(workspace);
      return result.kind === "updated"
        ? workspaceRuntimeId(workspace.id)
        : null;
    } catch (error) {
      logger.warn(`Failed to update workspace ${workspace.id}`, error);
      return null;
    } finally {
      release();
    }
  }

  /** Called during startup or with this turn's reservation held. */
  private async reconcileIntegration(
    workspace: ChatWorkspaceRow,
    health: RepositoryHealth,
  ): Promise<void> {
    const phase = workspace.integrationStatus;
    if (
      phase === "resolving-conflicts" &&
      !workspaceIntegrationQueue.hasPendingRepair(workspace.id)
    ) {
      workspaceIntegrationQueue.dispatch(workspace.id, {
        type: "REPAIR_SETTLED",
        outcome: "interrupted",
      });
      return;
    }
    if (phase !== "idle" && phase !== "merged") return;
    const reason =
      health.branch !== workspace.branch
        ? `Switch this worktree back to ${workspace.branch} before retrying.`
        : health.operationInProgress
          ? `An unfinished Git ${health.operationInProgress} needs attention in this workspace.`
          : !health.isClean
            ? "This workspace has uncommitted changes. Review them in this chat before merging."
            : null;
    if (reason) {
      workspaceIntegrationQueue.dispatch(workspace.id, {
        type: "PAUSE_PENDING_WORK",
        reason,
      });
      return;
    }
    if (health.headOid === workspace.lastIntegratedCommit) return;
    // Rewritten history isn't a missed turn commit. Only recover descendants
    // of the last integrated worktree HEAD, independently of the target squash.
    if (
      await isAncestorCommit({
        path: workspace.path,
        ancestor: workspace.lastIntegratedCommit,
        descendant: health.headOid,
      }).catch((error) => {
        logger.warn(
          `Could not verify workspace ${workspace.id} history`,
          error,
        );
        return false;
      })
    ) {
      this.requestIntegration(workspace);
    } else {
      workspaceIntegrationQueue.dispatch(workspace.id, {
        type: "PAUSE_PENDING_WORK",
        reason:
          "Dyad could not verify this workspace's history against its last merge. Review it before retrying.",
      });
    }
  }

  private requestIntegration(workspace: ChatWorkspaceRow): void {
    workspaceIntegrationQueue.dispatch(workspace.id, {
      type: "REQUESTED",
      userInitiated: false,
    });
  }

  /** Retries a paused or failed integration on the user's request. */
  async retryIntegration(chatId: number): Promise<void> {
    await this.waitForRecovery();
    const workspace = getWorkspaceForChat(chatId);
    if (!workspace || workspace.status !== "active") {
      throw new DyadError(
        "This chat has no isolated workspace",
        DyadErrorKind.NotFound,
      );
    }
    if (workspaceIntegrationQueue.hasPendingRepair(workspace.id)) {
      throw new DyadError(
        "Conflict resolution is still running.",
        DyadErrorKind.Conflict,
      );
    }
    // The queue rechecks Git under its workspace claim when starting the retry.
    // The user asked to check again, so earlier verdicts are not reused.
    workspaceIntegrationQueue.forgetValidation(workspace.id);
    workspaceIntegrationQueue.dispatch(workspace.id, {
      type: "REQUESTED",
      userInitiated: true,
    });
  }

  /**
   * Called when app deletion starts, before it waits for admitted work: an
   * integration attempt (validation especially) would otherwise hold it up.
   */
  stopIntegrationForApp(appId: number): void {
    workspaceIntegrationQueue.stopApp(appId);
  }

  /**
   * Reschedules the app's workspaces that are mid-integration, after an app
   * deletion that stopped them did not go through.
   */
  resumeIntegrationForApp(appId: number): void {
    workspaceIntegrationQueue.resumePending(appId);
  }

  private async settleIsolatedTurn(
    workspaceId: number,
    reservation: WritableTurnReservation,
    handle: TurnWorkspace,
    mirrored: MirroredState,
  ): Promise<void> {
    try {
      const workspace = getWorkspaceById(workspaceId);
      const outcome = handle.outcome;
      if (!workspace) return;
      const appPath = getWorkspaceAppPath(workspace);
      if (!fs.existsSync(appPath)) return;
      if (isMergeInProgress(appPath)) {
        // Completed while this turn still owns the workspace; the queue
        // claims it to validate once the reservation is released below.
        await workspaceIntegrationQueue.settleMergeTurn(workspace.id, outcome);
        // A merge left behind by an attempt that already failed or finished
        // has no repair step to resume, so ask to integrate what the turn
        // completed (the queue ignores this while it is still working).
        const settled = getWorkspaceById(workspace.id);
        if (
          settled &&
          !isMergeInProgress(appPath) &&
          (settled.integrationStatus === "failed" ||
            settled.integrationStatus === "merged" ||
            settled.integrationStatus === "idle") &&
          !(await isWorkspaceIntegrated(settled))
        ) {
          this.requestIntegration(settled);
        }
        return;
      }
      // A turn that hit its step limit still committed its work, which then
      // merges like any other (it is validated first); only a cancelled or
      // failed turn waits for the next one.
      if (!outcome.completed) {
        if (
          (workspace.integrationStatus === "idle" ||
            workspace.integrationStatus === "queued" ||
            workspace.integrationStatus === "merged") &&
          !(await isWorkspaceIntegrated(workspace))
        ) {
          workspaceIntegrationQueue.dispatch(workspace.id, {
            type: "PAUSE_PENDING_WORK",
            reason:
              "The turn was interrupted. Its commits are kept in this workspace. Continue in this chat or retry the merge.",
          });
        }
        return;
      }
      if (!(await isWorkspaceIntegrated(workspace))) {
        this.requestIntegration(workspace);
      } else if (workspace.integrationStatus === "resolving-conflicts") {
        // The merge was completed another way; let the queue reconcile.
        this.requestIntegration(workspace);
      }
    } catch (error) {
      logger.error(`Failed to settle turn for workspace ${workspaceId}`, error);
    } finally {
      const settledWorkspace = getWorkspaceById(workspaceId);
      // Resolved again: the app's folder may have moved during the turn, and
      // mirroring into its old location would recreate a stray folder there.
      const original = settledWorkspace
        ? await getOriginalAppPath(settledWorkspace.appId).catch(() => null)
        : null;
      if (settledWorkspace && original && fs.existsSync(original)) {
        await mirrorMedia(getWorkspaceAppPath(settledWorkspace), original, {
          includeManifest: false,
          skip: mirrored.mediaBaseline,
        }).catch((error) =>
          logger.warn("Failed to mirror media back to the app", error),
        );
        if (mirrored.copyWorkingPlanBack) {
          await mirrorWorkingPlanBack(
            getWorkspaceAppPath(settledWorkspace),
            original,
            settledWorkspace.chatId,
            mirrored.planBaseline,
          ).catch((error) =>
            logger.warn(
              "Failed to copy the chat's plan back to the app",
              error,
            ),
          );
        }
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
    mediaBaseline?: Set<string>,
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
      onMediaSavedToApp: mediaBaseline
        ? (name) => {
            mediaBaseline.add(name);
          }
        : undefined,
      outcome: { completed: false, stepLimitReached: false },
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
          workspace.status === "active" && fs.existsSync(workspace.path),
      );
      if (workspaces.length === 0) return;
      const original = await getOriginalAppPath(appId);
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
    return chat ? getOriginalAppPath(chat.appId) : null;
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

  /* Removal -------------------------------------------------------------- */

  /**
   * Deletes a chat's worktree on the user's request, whether or not its work
   * is merged; nothing removes worktrees automatically. Refused while a turn,
   * a merge step, or a read-only turn is using it. Commits that are not merged
   * into the target stay reachable on the branch (only a fully merged branch
   * is deleted); uncommitted changes are discarded. The chat's next writable
   * turn gets a new worktree.
   */
  async deleteChatWorkspace(chatId: number): Promise<void> {
    await this.waitForRecovery();
    const workspace = getWorkspaceForChat(chatId);
    if (
      !workspace ||
      (workspace.status !== "active" && workspace.status !== "unavailable")
    ) {
      throw new DyadError(
        "This chat has no worktree to delete",
        DyadErrorKind.NotFound,
      );
    }
    if (workspace.integrationStatus === "resolving-conflicts") {
      // A repair turn is queued for this worktree's in-progress merge.
      throw new DyadError(
        "This chat's worktree is in use by its agent or a merge. Try again once it finishes.",
        DyadErrorKind.Conflict,
      );
    }
    const releaseClaim = chatWorkspaceRegistry.tryClaimWorkspaceForRemoval(
      workspace.appId,
      workspace.id,
    );
    if (!releaseClaim) {
      throw new DyadError(
        "This chat's worktree is in use by its agent or a merge. Try again once it finishes.",
        DyadErrorKind.Conflict,
      );
    }
    try {
      await this.removeClaimedWorkspace(workspace);
    } finally {
      releaseClaim();
    }
    sendTelemetryEvent("workspace:deleted", {
      phase: workspace.integrationStatus,
    });
  }

  /**
   * Removes a workspace whose chat is being deleted. Waits briefly for an
   * integration step to let go, then proceeds.
   */
  private async forceRemoveWorkspace(workspace: ChatWorkspaceRow) {
    let releaseClaim = chatWorkspaceRegistry.tryClaimWorkspaceForRemoval(
      workspace.appId,
      workspace.id,
    );
    const deadline = Date.now() + FORCED_REMOVAL_WAIT_MS;
    while (!releaseClaim && Date.now() < deadline) {
      workspaceIntegrationQueue.forget(workspace.appId, workspace.id);
      await chatWorkspaceRegistry.waitForChange(undefined, {
        timeoutMs: 1_000,
      });
      releaseClaim = chatWorkspaceRegistry.tryClaimWorkspaceForRemoval(
        workspace.appId,
        workspace.id,
      );
    }
    if (!releaseClaim) {
      // Something still holds it (a proposal approval, for example). Never
      // delete under a writer: the chat's row is going away, so the folder
      // becomes an orphan that the startup sweep removes. Its preview has
      // no chat left to show it, and would keep the port a later workspace
      // with the same id is given.
      workspaceIntegrationQueue.forget(workspace.appId, workspace.id);
      await this.disposeWorkspaceRuntime(workspace.id);
      logger.warn(
        `Left workspace ${workspace.id} for the startup sweep: it is still in use`,
      );
      return;
    }
    try {
      await this.removeClaimedWorkspace(workspace);
    } finally {
      releaseClaim();
    }
  }

  private async removeClaimedWorkspace(
    workspace: ChatWorkspaceRow,
  ): Promise<void> {
    // Work reaches the target as a squash, so Git never sees the branch as
    // merged; delete it only when its HEAD is the integrated one.
    const current = getWorkspaceById(workspace.id) ?? workspace;
    const original = await getOriginalAppPath(current.appId);
    const verified =
      current.status === "active" &&
      original !== null &&
      isLinkedWorktreeOf(current.path, original) &&
      (await gitCurrentBranch({ path: current.path }).catch(() => null)) ===
        current.branch;
    const integrated =
      verified && (await isWorkspaceIntegrated(current).catch(() => false));
    // Read before the files go: the functions this worktree's unmerged work
    // deployed are redeployed from the app's folder once it is removed.
    const supabaseFunctions = verified
      ? await unmergedSupabaseFunctionChanges(current)
      : null;
    updateWorkspace(workspace.id, { status: "removing" });
    workspaceIntegrationQueue.forget(workspace.appId, workspace.id);
    try {
      await this.deleteWorkspaceFiles(workspace, integrated);
    } catch (error) {
      if (fs.existsSync(current.path)) {
        // A surviving directory may have already lost its Git link. Only
        // restore missing files from the verified workspace index.
        const restored =
          original !== null &&
          isLinkedWorktreeOf(current.path, original) &&
          (await gitCurrentBranch({ path: current.path }).catch(() => null)) ===
            current.branch &&
          (await restoreMissingTrackedFiles(current.path).catch(() => false)) &&
          fs.existsSync(getWorkspaceAppPath(current));
        if (restored && current.status !== "unavailable") {
          updateWorkspace(workspace.id, { status: "active" });
          // Only this app: another app's deletion may be holding its own
          // integrations stopped.
          workspaceIntegrationQueue.resumePending(workspace.appId);
          publishWorkspaceChanged(workspace.appId);
        } else {
          markWorkspaceUnavailable(workspace, FAILED_REMOVAL_DETAIL);
        }
        throw error;
      }
      // Its folder is gone, so it is unusable either way; finish removing
      // the record. A leftover marker is swept as an orphan at startup.
      logger.warn(
        `Removing workspace ${workspace.id} failed after its folder was deleted`,
        error,
      );
    }
    deleteWorkspaceRow(workspace.id);
    logger.info(`Removed isolated workspace ${workspace.path}`);
    publishWorkspaceChanged(workspace.appId);
    // Outside the removal's claims, like any other redeploy.
    if (supabaseFunctions) {
      resyncSupabaseFunctionsFromApp({
        appId: workspace.appId,
        changes: supabaseFunctions,
        reason: "worktree-deleted",
      });
    }
  }

  /** Stops the workspace's runtime and deletes its worktree and marker. */
  private async deleteWorkspaceFiles(
    workspace: ChatWorkspaceRow,
    integrated: boolean,
  ): Promise<void> {
    await this.disposeWorkspaceRuntime(workspace.id);
    const original = await getOriginalAppPath(workspace.appId);
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
          if (integrated) {
            await forceDeleteBranch({
              repositoryPath,
              branch: workspace.branch,
            });
          } else {
            logger.info(
              `Kept branch ${workspace.branch}: it has work that is not merged`,
            );
          }
        } else {
          await fsPromises.rm(workspace.path, { recursive: true, force: true });
        }
        await fsPromises.rm(markerPath(workspace.path), { force: true });
      },
    );
  }

  /**
   * Called before a chat is deleted (after its turns are drained), and
   * returns the removal of its workspace to run once the chat row's delete
   * has committed. Removing first would throw away the worktree, uncommitted
   * changes included, of a chat whose delete then failed. Unmerged commits
   * stay reachable on the branch because only merged branches are deleted.
   */
  prepareChatDeletion(chatId: number): () => Promise<void> {
    // Captured now: deleting the chat row deletes this one by cascade.
    const workspace = getWorkspaceForChat(chatId);
    return async () => {
      if (!workspace) return;
      await this.forceRemoveWorkspace(workspace).catch((error) =>
        logger.warn(
          `Failed to remove workspace of deleted chat ${chatId}`,
          error,
        ),
      );
    };
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
    const repositories = new Set<string>();
    for (const workspace of workspaces) {
      await this.disposeWorkspaceRuntime(workspace.id);
      const marker = await readMarker(workspace.path);
      if (marker) repositories.add(marker.sourceRepoPath);
      await fsPromises
        .rm(workspace.path, { recursive: true, force: true })
        .catch(() => undefined);
      await fsPromises
        .rm(markerPath(workspace.path), { force: true })
        .catch(() => undefined);
    }
    // An app in a subfolder of a repository outlives it with that
    // repository: drop the worktree registrations of the deleted folders so
    // their branches can be checked out again. The branches stay, since they
    // may hold work that was never merged.
    for (const repository of repositories) {
      if (!fs.existsSync(repository)) continue;
      await pruneGitWorktrees(repository).catch((error) =>
        logger.warn(`Failed to prune worktrees of ${repository}`, error),
      );
    }
  }

  /* Startup ------------------------------------------------------------- */

  /**
   * Reconciles persisted workspace state with Git after a restart. Recovery
   * inspects the actual repository before retrying anything: an integration
   * that finished before its status was saved is recorded as merged, an
   * unfinished merge is kept for the user, and queued work resumes.
   */
  private recovery: Promise<void> | null = null;

  /**
   * Resolves once startup recovery has reconciled workspaces with Git.
   * Startup does not wait for it (it runs Git in every worktree), so every
   * operation that changes a workspace waits here instead.
   */
  async waitForRecovery(): Promise<void> {
    await this.recovery?.catch(() => undefined);
  }

  async recover(): Promise<void> {
    const recovery = this.recoverNow();
    this.recovery = recovery;
    try {
      await recovery;
    } finally {
      if (this.recovery === recovery) this.recovery = null;
    }
  }

  private async recoverNow(): Promise<void> {
    try {
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
    } finally {
      // Even after a failure above: queued integrations must still resume,
      // and the queue must observe registry changes.
      workspaceIntegrationQueue.start();
      workspaceIntegrationQueue.resumePending();
    }
  }

  /**
   * Whether the fast-forward of an "integrating" attempt landed before a
   * restart: the target moved off the commit the attempt merged and now has
   * exactly the workspace's files. Records the squash in the workspace if the
   * restart came first, and marks the work merged.
   */
  private async recoverLandedSquash(
    workspace: ChatWorkspaceRow,
    original: string,
  ): Promise<boolean> {
    const appPath = getWorkspaceAppPath(workspace);
    const target = await getCurrentCommitHash({
      path: original,
      ref: `refs/heads/${workspace.targetBranch}`,
    });
    if (target === workspace.integrationTargetCommit) return false;
    const head = await getCurrentCommitHash({ path: appPath });
    if (!(await haveSameTree({ path: appPath, a: head, b: target }))) {
      return false;
    }
    const recorded = (await isAncestorCommit({
      path: appPath,
      ancestor: target,
      descendant: head,
    }))
      ? head
      : await recordIntegratedSquash(workspace, target).catch(() => head);
    updateWorkspace(workspace.id, {
      integrationStatus: "merged",
      integrationDetail: null,
      integrationTargetCommit: null,
      repairAttempts: 0,
      lastIntegratedCommit: recorded,
    });
    return true;
  }

  private async recoverWorkspace(workspace: ChatWorkspaceRow): Promise<void> {
    if (workspace.status === "unavailable") return;
    if (workspace.status === "removing") {
      await this.removeClaimedWorkspace(workspace);
      return;
    }
    if (workspace.status === "creating") {
      const original = await getOriginalAppPath(workspace.appId);
      if (original) {
        await removeLinkedWorktree({
          repositoryPath: original,
          worktreePath: workspace.path,
        }).catch(() => undefined);
        await deleteMergedBranch({
          repositoryPath: original,
          branch: workspace.branch,
        }).catch(() => undefined);
      }
      // Without its row, the folder is an orphan: the sweep below retries it
      // through the marker's repository, so the marker stays with it.
      await removeMarkerIfFolderGone(workspace.path);
      deleteWorkspaceRow(workspace.id);
      return;
    }
    const appPath = getWorkspaceAppPath(workspace);
    if (!fs.existsSync(workspace.path)) return;
    const phase = workspace.integrationStatus;
    const original = await getOriginalAppPath(workspace.appId);
    if (!original || !fs.existsSync(original)) return;
    if (
      !isLinkedWorktreeOf(workspace.path, original) ||
      !fs.existsSync(appPath)
    ) {
      markWorkspaceUnavailable(workspace, INCOMPLETE_WORKTREE_DETAIL);
      return;
    }
    switch (phase) {
      case "integrating":
      case "validating":
      case "merging":
      case "queued": {
        if ((await gitCurrentBranch({ path: appPath })) !== workspace.branch) {
          workspaceIntegrationQueue.dispatch(workspace.id, {
            type: "FAILED",
            reason: `Switch this worktree back to ${workspace.branch} before retrying.`,
          });
          return;
        }
        if (
          phase === "integrating" &&
          (await this.recoverLandedSquash(workspace, original).catch(
            () => false,
          ))
        ) {
          return;
        }
        if (isMergeInProgress(appPath)) {
          const conflicts = await readMergeConflicts(appPath);
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
        if (workspaceIntegrationQueue.hasPendingRepair(workspace.id)) return;
        updateWorkspace(workspace.id, {
          integrationStatus: "paused",
          integrationDetail:
            "Dyad restarted while this chat was resolving conflicts. Send a message in this chat to continue.",
        });
        return;
      case "idle":
      case "merged": {
        await this.reconcileIntegration(
          workspace,
          await inspectRepositoryHealth({ path: appPath }),
        );
        return;
      }
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
        // A folder that survived is retried at the next startup.
        await removeMarkerIfFolderGone(worktreeRoot);
      }
    }
  }
}

export const chatWorkspaceService = new ChatWorkspaceService();
