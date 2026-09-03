import { promises as fs } from "node:fs";
import path from "node:path";
import log from "electron-log";

import { getUserDataPath } from "@/paths/paths";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  createGitOverlayWorkspace,
  isGitOverlayWorkspaceActive,
  readGitOverlayWorkspaceMarker,
  removeGitOverlayWorkspace,
} from "@/ipc/services/git_overlay_workspace";
import {
  resolvePackageManager,
  runCleanPackageInstall,
  type IsolatedPackageManager,
} from "@/ipc/services/isolated_package_install";
import { trackE2eTestProcess } from "@/ipc/services/e2e_test_process_registry";
import { isMissingPathError } from "../../../shared/node_module_resolution";

const logger = log.scope("e2e_test_workspace");

const DEPENDENCY_INSTALL_TIMEOUT_MS = 15 * 60_000;
const MAX_INSTALL_ERROR_CHARS = 8_000;

/**
 * Generated roots the sandbox drops, matched directly under the app directory
 * (`node_modules` is the exception and is dropped at any depth). Deliberately
 * not matched at every depth: `rules/local-agent-tools.md` warns that a path
 * like `app/out/page.tsx` is application source, not build output.
 *
 * The non-Node entries are not just a copy-cost saving. A virtualenv records
 * absolute paths in `pyvenv.cfg` and its script shebangs, so a copied `.venv`
 * activates an interpreter pointing back at the live checkout — a custom-command
 * app running `. .venv/bin/activate && …` would silently escape its own sandbox.
 * `vendor`, `target` and the rest are the same story for copy cost, and every
 * one of them is rebuilt by the app's own install command when it needs it.
 */
const EXCLUDED_ROOTS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".vite",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "test-results",
  "playwright-report",
  "coverage",
  // Playwright's downloaded browsers, which the bootstrap re-resolves from its
  // global cache. Nested, so it cannot be expressed as a bare root name — an
  // app's own `playwright/` directory may hold fixtures worth copying.
  "playwright/.cache",
  // Python
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  // Rust / Go / PHP / Ruby
  "target",
  "vendor",
  // Package-manager stores and caches
  ".yarn",
  ".pnpm-store",
  ".gradle",
  // iOS / macOS
  "Pods",
]);

export const E2E_TEST_SANDBOX_DIR = "test-sandboxes";
export const E2E_TEST_ARTIFACT_DIR = "test-artifacts";

/**
 * Run directories owned by an in-flight run. The startup orphan sweep skips
 * these so it can never delete a sandbox out from under a run that started
 * while the sweep was still walking a multi-gigabyte tree.
 */
const activeWorkspaceNames = new Set<string>();

export interface E2eTestWorkspace {
  workspacePath: string;
  artifactPath: string;
  packageManager?: IsolatedPackageManager;
  dependencyInstallPath?: string;
  usesWorkspaceInstallRoot?: boolean;
  dispose(): Promise<void>;
}

/**
 * Create a root and return it symlink-resolved.
 *
 * Every later containment check compares this prefix against a path some other
 * process reported. Playwright resolves its artifact paths against the runner's
 * `process.cwd()`, which the OS hands back with symlinks already collapsed — so
 * an un-resolved root silently fails to match whenever any ancestor is a link
 * (`/var` → `/private/var` on macOS, which is exactly what `os.tmpdir()` and so
 * `DYAD_DEV_USER_DATA_DIR` give). `rewriteE2eArtifactPath` would then answer
 * `undefined` for every screenshot and the failures would lose their thumbnails
 * and page snapshots with nothing logged. `test_screenshot.ts` resolves both
 * sides of its own check for the same reason.
 */
async function realpathRoot(root: string): Promise<string> {
  await fs.mkdir(root, { recursive: true });
  return fs.realpath(root);
}

function assertOwnedPath(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove path outside the E2E workspace root.`);
  }
}

function installOutputTail(stdout: string, stderr: string): string {
  const output = [stdout, stderr].filter(Boolean).join("\n").trim();
  return output.length <= MAX_INSTALL_ERROR_CHARS
    ? output
    : `[Earlier output omitted]\n${output.slice(-MAX_INSTALL_ERROR_CHARS)}`;
}

export async function createE2eTestWorkspace({
  appId,
  appPath,
  hasCustomCommands = false,
  signal,
}: {
  appId: number;
  appPath: string;
  /**
   * The app supplies its own install and start commands, so it may not be a
   * Node project and a missing `node_modules` is not a reason to refuse.
   */
  hasCustomCommands?: boolean;
  signal?: AbortSignal;
}): Promise<E2eTestWorkspace> {
  if (signal?.aborted) throw new Error("Test run stopped.");

  const sandboxRoot = await realpathRoot(
    path.join(getUserDataPath(), E2E_TEST_SANDBOX_DIR),
  );
  const artifactRoot = await realpathRoot(
    path.join(getUserDataPath(), E2E_TEST_ARTIFACT_DIR),
  );
  // The previous run's artifacts are deliberately NOT pruned here. The panel is
  // still showing that run's results, and every screenshot path on them points
  // into the directory this would delete — so a new run that then fails during
  // setup would leave the user looking at results whose thumbnails silently
  // stop loading. `retainE2eTestArtifacts` prunes them once this run has
  // produced replacements.

  const startedAt = Date.now();
  const snapshot = await createGitOverlayWorkspace({
    sourceTargetPath: appPath,
    scratchRoot: sandboxRoot,
    directoryPrefix: `${appId}-`,
    purpose: "e2e-test",
    excludedTargetRootNames: EXCLUDED_ROOTS,
    signal,
  });
  const runName = path.basename(snapshot.worktreePath);
  const workspacePath = snapshot.targetPath;
  const artifactPath = path.join(artifactRoot, runName);
  assertOwnedPath(sandboxRoot, snapshot.worktreePath);
  assertOwnedPath(artifactRoot, artifactPath);
  activeWorkspaceNames.add(runName);
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    assertOwnedPath(sandboxRoot, snapshot.worktreePath);
    const disposeStartedAt = Date.now();
    try {
      await removeGitOverlayWorkspace(
        snapshot.worktreePath,
        snapshot.sourceRepoPath,
      );
      sendTelemetryEvent("e2e_test_workspace_disposed", {
        duration_ms: Date.now() - disposeStartedAt,
        platform: process.platform,
      });
    } finally {
      activeWorkspaceNames.delete(runName);
    }
  };

  try {
    if (signal?.aborted) throw new Error("Test run stopped.");
    let packageManager: IsolatedPackageManager | undefined;
    let dependencyInstallPath: string | undefined;
    let usesWorkspaceInstallRoot = false;
    if (!hasCustomCommands) {
      const resolution = await resolvePackageManager(
        snapshot.sourceTargetPath,
        snapshot.sourceRepoPath,
      );
      packageManager = resolution.packageManager;
      usesWorkspaceInstallRoot =
        resolution.sourceInstallPath !== snapshot.sourceTargetPath;
      dependencyInstallPath = path.join(
        snapshot.worktreePath,
        path.relative(snapshot.sourceRepoPath, resolution.sourceInstallPath),
      );
    }
    sendTelemetryEvent("e2e_test_workspace_created", {
      duration_ms: Date.now() - startedAt,
      snapshot_ms: snapshot.setupMs,
      package_manager: packageManager ?? "custom",
      workspace_install_root: usesWorkspaceInstallRoot,
      platform: process.platform,
    });
    return {
      workspacePath,
      artifactPath,
      packageManager,
      dependencyInstallPath,
      usesWorkspaceInstallRoot,
      dispose,
    };
  } catch (error) {
    // Never let cleanup replace the failure it is cleaning up after. Removing a
    // partial worktree can itself fail (EBUSY/EPERM on Windows), and that error
    // would otherwise bury the original, well-classified setup failure.
    try {
      await dispose();
    } catch (disposeError) {
      logger.warn(
        `Failed to remove a partial E2E test workspace after a setup failure: ${disposeError}`,
      );
    }
    throw error;
  }
}

export async function installE2eTestWorkspaceDependencies({
  workspace,
  signal,
  onOutput,
  ignoreScripts,
}: {
  workspace: E2eTestWorkspace;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  /**
   * Refuse to run the app's lifecycle scripts, for a workspace whose database
   * credentials are still the live ones. See the caller for which isolation
   * modes need it.
   */
  ignoreScripts?: boolean;
}): Promise<void> {
  const { dependencyInstallPath, packageManager } = workspace;
  if (!dependencyInstallPath || !packageManager) return;
  if (signal?.aborted) throw new Error("Test run stopped.");

  const startedAt = Date.now();
  const installResult = await runCleanPackageInstall({
    cwd: dependencyInstallPath,
    packageManager,
    signal,
    timeoutMs: DEPENDENCY_INSTALL_TIMEOUT_MS,
    onOutput,
    ignoreScripts,
    // The other two run-scoped children (the sandbox server and the Playwright
    // runner) register here for the same reason: `will-quit` cannot await the
    // async abort path, so aborting alone leaves a cold `npm ci` — budgeted at
    // 15 minutes — alive past the quit, holding the sandbox directory as its
    // cwd. That is exactly the state that makes the next launch's orphan sweep
    // fail on Windows.
    onProcess: trackE2eTestProcess,
  });
  if (installResult.aborted || signal?.aborted) {
    throw new Error("Test run stopped.");
  }
  const output = installOutputTail(installResult.stdout, installResult.stderr);
  if (installResult.timedOut) {
    throw new DyadError(
      `Installing dependencies in the isolated test workspace timed out after 15 minutes.${output ? `\n\n${output}` : ""}`,
      DyadErrorKind.Precondition,
    );
  }
  if (installResult.code !== 0) {
    throw new DyadError(
      `Could not install dependencies in the isolated test workspace (exit code ${installResult.code}).${output ? `\n\n${output}` : ""}`,
      DyadErrorKind.Precondition,
    );
  }
  sendTelemetryEvent("e2e_test_workspace_dependencies_installed", {
    duration_ms: Date.now() - startedAt,
    package_manager: packageManager,
    frozen_install: installResult.hasLockfile,
    workspace_install_root: workspace.usesWorkspaceInstallRoot ?? false,
    platform: process.platform,
  });
}

export async function retainE2eTestArtifacts(
  {
    workspacePath,
    artifactPath,
  }: Pick<E2eTestWorkspace, "workspacePath" | "artifactPath">,
  {
    replacesEveryResult = true,
  }: {
    /**
     * Whether this run's results replace every row the panel is showing.
     *
     * False for a file-only, single-test or grep run: `applyTestRunStartedAtom`
     * keeps the untargeted files' rows (and, for a single-test or grep run,
     * every prior result), and those rows carry `screenshotPath` values pointing
     * into earlier runs' artifact directories. Pruning everything but the newest
     * directory would delete the screenshots and page snapshots behind results
     * still on screen.
     */
    replacesEveryResult?: boolean;
  } = {},
): Promise<void> {
  const source = path.join(workspacePath, "test-results");
  let hasArtifacts = true;
  try {
    hasArtifacts = (await fs.stat(source)).isDirectory();
  } catch (error) {
    // Only "it isn't there" means there is nothing to retain. Any other stat
    // failure (EACCES, EIO, a path that grew too long) must not be reported to
    // the caller as a successful retention — it rewrites every screenshot path
    // into an artifact directory that was never written.
    if (!isMissingPathError(error)) throw error;
    hasArtifacts = false;
  }
  // Nothing was produced to replace the previous run's artifacts, so they are
  // still exactly what the panel is displaying. Pruning here would delete the
  // screenshots behind result rows this run never touched — the panel keeps a
  // file's siblings on a file run, and every prior result on a single-test or
  // grep run (`applyTestRunStartedAtom`).
  if (!hasArtifacts) return;
  try {
    await fs.rm(artifactPath, { recursive: true, force: true });
    await fs.mkdir(artifactPath, { recursive: true });
    await fs.cp(source, path.join(artifactPath, "test-results"), {
      recursive: true,
      verbatimSymlinks: false,
    });
  } catch (error) {
    // Drop this run's half-written directory so a copy that keeps failing
    // can't leave one behind per run. The PREVIOUS run's directory stays: the
    // caller drops this run's paths on failure, which leaves the older one as
    // the only thing the surviving rows still point at.
    await fs
      .rm(artifactPath, { recursive: true, force: true })
      .catch((cleanupError) =>
        logger.warn(
          `Failed to remove a partial E2E artifact directory ${artifactPath}: ${cleanupError}`,
        ),
      );
    throw error;
  }
  // Only once replacements are actually on disk.
  await pruneSupersededArtifacts(artifactPath, replacesEveryResult);
}

/**
 * Drop the app's superseded artifact directories, now that this run has
 * finished and produced replacements.
 *
 * Only a run that replaced every row on screen prunes. Anything narrower — a
 * single file, a single test, a grep — leaves earlier rows in place
 * (`applyTestRunStartedAtom` keeps the untargeted files' results, and every
 * prior result for a single-test or grep run), and those rows carry screenshot
 * paths into the directories this would delete. A count-based bound was the
 * obvious alternative and is not one: the renderer holds the references, so no
 * number chosen here is the one that is always enough. Directories therefore
 * accumulate until the next full run, which clears all of them at once — and
 * the startup sweep still collects a deleted app's.
 *
 * Runs belonging to another in-flight test run are skipped. `runAppTestsCore`
 * is reached only through `runAppTestsWithIsolation`, which now awaits the
 * prior run's `done` before starting, so two runs for one app should never
 * overlap here — the skip is kept as the cheap guard that stops a future
 * concurrent-run change from silently deleting the other run's screenshots
 * before they ever reach the panel.
 */
async function pruneSupersededArtifacts(
  artifactPath: string,
  replacesEveryResult: boolean,
): Promise<void> {
  if (!replacesEveryResult) return;
  const runName = path.basename(artifactPath);
  const appId = runDirectoryAppId(runName);
  if (appId === null) return;
  await removeRunDirectories(
    path.dirname(artifactPath),
    (name) =>
      name !== runName &&
      !activeWorkspaceNames.has(name) &&
      runDirectoryAppId(name) === appId,
    "test artifacts",
  );
}

export function rewriteE2eArtifactPath(
  screenshotPath: string | undefined,
  workspacePath: string,
  artifactPath: string | undefined,
): string | undefined {
  if (!screenshotPath || !artifactPath) return undefined;
  const absolute = path.isAbsolute(screenshotPath)
    ? path.resolve(screenshotPath)
    : path.resolve(workspacePath, screenshotPath);
  const relative = path.relative(workspacePath, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return path.join(artifactPath, relative);
}

/**
 * Run directory names are `<appId>-<mkdtemp suffix>`; recover the id from one.
 *
 * The single parser every owner check goes through — the artifact prune and the
 * screenshot reader both decide "is this run mine?" from it, and a second,
 * hand-rolled prefix test in either place is how the two drift apart.
 *
 * The delimiter and a non-empty suffix are both required. Without them a bare
 * `7` in the user-data directory — something Dyad never creates and has no
 * claim on — would parse as an app-7 run and be swept away by the prune.
 */
export function runDirectoryAppId(name: string): number | null {
  const match = /^(\d+)-.+$/.exec(name);
  if (!match) return null;
  const appId = Number(match[1]);
  return Number.isSafeInteger(appId) ? appId : null;
}

async function removeRunDirectories(
  root: string,
  shouldRemove: (name: string, runPath: string) => boolean | Promise<boolean>,
  label: string,
  removePath: (runPath: string) => Promise<void> = (runPath) =>
    fs.rm(runPath, { recursive: true, force: true }),
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      logger.warn(`Failed to list abandoned E2E ${label}: ${error}`);
    }
    return;
  }
  for (const entry of entries) {
    const runPath = path.join(root, entry.name);
    // Both callers remove run *directories*. A regular file (or a symlink)
    // whose name happens to match the run-name shape is not one of ours to
    // interpret, let alone delete.
    if (!entry.isDirectory()) continue;
    if (!(await shouldRemove(entry.name, runPath))) continue;
    try {
      assertOwnedPath(root, runPath);
      await removePath(runPath);
    } catch (error) {
      logger.warn(
        `Failed to remove abandoned E2E ${label} ${entry.name}: ${error}`,
      );
    }
  }
}

/** Drop every retained artifact directory belonging to one app. */
export async function removeE2eTestArtifactsForApp(
  appId: number,
): Promise<void> {
  await removeRunDirectories(
    path.join(getUserDataPath(), E2E_TEST_ARTIFACT_DIR),
    (name) => runDirectoryAppId(name) === appId,
    "test artifacts",
  );
}

/**
 * Remove sandboxes and artifacts left behind by a crash or a deleted app.
 *
 * Sandboxes are deleted one run directory at a time, skipping any run this
 * process still owns, rather than by removing the shared root: the sweep is
 * fire-and-forget from startup and removing a dependency-heavy tree is not
 * instantaneous, so a Run pressed right after launch would otherwise be
 * deleted during setup and surface as an unexplained ENOENT.
 *
 * Artifacts are otherwise only replaced by the next run of the same app, so
 * without `refreshKnownAppIds` a deleted app's screenshots and traces would sit
 * in user data forever with no surface that shows they exist. It is a callback,
 * not a set: the sandbox sweep above can run long enough for the app list to
 * change under it, and a set captured before that would delete a new app's
 * artifacts.
 */
export async function reconcileOrphanE2eTestWorkspaces({
  refreshKnownAppIds,
}: {
  refreshKnownAppIds?: () => Promise<ReadonlySet<number>>;
} = {}): Promise<void> {
  const userDataPath = getUserDataPath();
  // Resolved, but without creating anything: `isGitOverlayWorkspaceActive`
  // compares against the paths a live run registered, and those are now
  // symlink-resolved. An un-resolved root here would miss that match and fall
  // through to the marker check, which a run in flight also passes.
  const sandboxRoot = await fs
    .realpath(path.join(userDataPath, E2E_TEST_SANDBOX_DIR))
    .catch(() => path.join(userDataPath, E2E_TEST_SANDBOX_DIR));
  await removeRunDirectories(
    sandboxRoot,
    async (name, runPath) => {
      if (
        activeWorkspaceNames.has(name) ||
        isGitOverlayWorkspaceActive(runPath)
      ) {
        return false;
      }
      return (
        (await readGitOverlayWorkspaceMarker(runPath))?.purpose === "e2e-test"
      );
    },
    "test workspaces",
    (runPath) => removeGitOverlayWorkspace(runPath),
  );
  if (!refreshKnownAppIds) return;
  // Re-read, rather than trusting the set the caller assembled before the sweep
  // above began. Deleting an abandoned dependency-heavy sandbox is tens of
  // thousands of unlinks and can run for a long time — long enough for the user
  // to create an app and finish its first test run, whose freshly retained
  // artifacts a stale set would classify as orphaned and delete, leaving the
  // results on screen with broken screenshot paths.
  const knownAppIds = await refreshKnownAppIds();
  await removeRunDirectories(
    path.join(userDataPath, E2E_TEST_ARTIFACT_DIR),
    (name) => {
      // A run that started while this sweep was working is not orphaned, and
      // its directory is not on the row this set was built from either.
      if (activeWorkspaceNames.has(name)) return false;
      const appId = runDirectoryAppId(name);
      // An unparseable name isn't ours to interpret; leave it alone.
      return appId !== null && !knownAppIds.has(appId);
    },
    "test artifacts",
  );
}
