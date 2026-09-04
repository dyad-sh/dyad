import type { ChildProcess } from "node:child_process";
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
  findWorkspacePackageDirectories,
  resolvePackageManager,
  runCleanPackageInstall,
  type IsolatedPackageManager,
} from "@/ipc/services/isolated_package_install";
import { trackE2eTestProcess } from "@/ipc/services/e2e_test_process_registry";
import { isMissingPathError } from "../../../shared/node_module_resolution";
import { ENV_FILE_NAME } from "@/ipc/utils/app_env_var_utils";
import {
  isDatabaseEnvKey,
  withoutInheritedDatabaseEnv,
} from "@/ipc/utils/sandbox_env";
import { forceKillProcessTree } from "@/ipc/utils/process_manager";
import { getPackageManagerCommandEnv } from "@/ipc/utils/socket_firewall";

const logger = log.scope("e2e_test_workspace");

const DEPENDENCY_INSTALL_TIMEOUT_MS = 15 * 60_000;
const MAX_INSTALL_ERROR_CHARS = 8_000;

/**
 * Generated *output* roots the sandbox drops, matched directly under the app
 * directory only.
 *
 * Deliberately not matched at every depth: `rules/local-agent-tools.md` warns
 * that a path like `app/out/page.tsx` is application source, not build output,
 * so these names are safe to drop only where an app root makes them
 * unambiguous.
 *
 * Installed environments — `node_modules`, `.venv`, `.yarn`, `Pods` and the
 * rest — are NOT here. They are never source, so `git_overlay_workspace` drops
 * them at any depth and never preserves them even when tracked, which is what
 * stops a monorepo sibling's virtualenv (whose `pyvenv.cfg` and shebangs hold
 * absolute paths back into the live checkout) from reaching the sandbox.
 */
const EXCLUDED_ROOTS = new Set([
  "dist",
  "build",
  "out",
  ".vite",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".cache",
  "test-results",
  "playwright-report",
  "coverage",
  // Playwright's downloaded browsers, which the bootstrap re-resolves from its
  // global cache. Nested, so it cannot be expressed as a bare root name — an
  // app's own `playwright/` directory may hold fixtures worth copying.
  "playwright/.cache",
  // Committed vendor trees are a build *input* for Go and PHP, so this stays
  // app-anchored and preserved when tracked, unlike the environment roots.
  "vendor",
  "target",
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
  if (signal?.aborted)
    throw new DyadError("Test run stopped.", DyadErrorKind.UserCancelled);

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
    if (signal?.aborted)
      throw new DyadError("Test run stopped.", DyadErrorKind.UserCancelled);
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

/**
 * Environment variables withheld from the workspace while its dependencies
 * install.
 *
 * A clean install runs the app's own lifecycle scripts, and a generated app's
 * `postinstall` routinely migrates or seeds a database. The sandbox's
 * `.env.local` is a verbatim copy of the live one unless isolation rewrote it,
 * so those scripts would reach the user's real data on the way into a run that
 * calls itself isolated.
 *
 * Withheld rather than suppressed with `--ignore-scripts`: that flag is not
 * selective, and disabling every lifecycle script would break `prisma
 * generate`, native rebuilds and codegen for apps that merely happen to have a
 * database — turning working test runs into a server that cannot start. Taking
 * the credentials away leaves the scripts running and only denies them the one
 * thing they must not reach. A script that genuinely needs the database fails
 * loudly, which is the right way round.
 */
/**
 * Every dotenv file an install script may load, not just the one Dyad writes.
 *
 * `ENV_FILE_NAME` is the only file provider isolation rewrites, but a
 * `postinstall` that calls `dotenv.config()` reads `.env` by default, and
 * framework loaders (Next.js, Vite) walk a whole cascade. A credential left in
 * any of them is read from disk by the script regardless of what the process
 * environment says — which is why sanitizing `process.env` alone is not enough.
 */
const DOTENV_FILE_NAMES: readonly string[] = [
  ".env",
  ENV_FILE_NAME,
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
  ".env.production",
  ".env.production.local",
];

/** Rewrite one dotenv file without the database credentials; return the original. */
async function withheldEnvFile(
  directory: string,
  fileName: string,
): Promise<string | null> {
  const envPath = path.join(directory, fileName);
  let original: string;
  try {
    original = await fs.readFile(envPath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
  const kept = original
    .split("\n")
    .filter((line) => {
      const key = line.split("=", 1)[0]?.trim();
      // Comments and blanks have no key and stay; anything naming a database
      // goes for the duration of the install.
      return !key || key.startsWith("#") || !isDatabaseEnvKey(key);
    })
    .join("\n");
  if (kept === original) return null;
  await fs.writeFile(envPath, kept, "utf8");
  return original;
}

/**
 * Run `install` with the workspace's database credentials withheld from every
 * dotenv file in every directory the install can reach, and put them back
 * afterwards.
 *
 * The app directory alone is not the reachable set. A monorepo's root
 * `postinstall` reads the ROOT dotenv files, which no provider isolation
 * rewrites, and both package managers install *every* workspace member from
 * that root and run each member's lifecycle scripts — so a sibling package's
 * copied `.env` is a live credential source for this install too.
 *
 * `settle` runs before anything is restored, and its verdict decides whether
 * anything is restored at all. `spawnStreaming` starts a `treeKill` and returns
 * without waiting for the tree on a Stop or a timeout, so restoring immediately
 * would hand the real credentials back to an install script that is still
 * running — and `rules/app-operation-coordination.md` requires the barrier
 * before the caller can go on to delete the workspace and release its claim.
 *
 * A `false` verdict FAILS CLOSED: the files stay stripped. Nothing is lost by
 * that — the run is already over and this whole directory is a disposable copy
 * — whereas restoring would be handing live credentials to a process that is
 * demonstrably still alive.
 */
async function withWithheldDatabaseEnv<T>(
  directories: readonly string[],
  install: () => Promise<T>,
  settle?: () => Promise<boolean>,
): Promise<T> {
  const restore = new Map<string, string>();
  try {
    for (const directory of new Set(directories)) {
      for (const fileName of DOTENV_FILE_NAMES) {
        const original = await withheldEnvFile(directory, fileName);
        if (original !== null) {
          restore.set(path.join(directory, fileName), original);
        }
      }
    }
    return await install();
  } finally {
    const settled = settle
      ? await settle().catch((error) => {
          logger.warn(
            `Failed to confirm the sandbox install had stopped: ${error}`,
          );
          return false;
        })
      : true;
    if (settled) {
      for (const [envPath, original] of restore) {
        await fs
          .writeFile(envPath, original, "utf8")
          .catch((error) =>
            logger.warn(
              `Failed to restore the sandbox environment in ${envPath} after installing: ${error}`,
            ),
          );
      }
    } else {
      // No early `return` here: one inside a `finally` discards whatever the
      // `try` was returning or throwing, which would swallow the install's own
      // result along with its failures.
      logger.warn(
        "Leaving the sandbox database credentials withheld: the install process tree could not be confirmed stopped.",
      );
    }
  }
}

export async function installE2eTestWorkspaceDependencies({
  workspace,
  signal,
  onOutput,
  withholdDatabaseEnv,
}: {
  workspace: E2eTestWorkspace;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  /**
   * Withhold the workspace's database credentials for the duration of the
   * install, so lifecycle scripts run but cannot reach the user's real data.
   * See the caller for which isolation modes need it.
   */
  withholdDatabaseEnv?: boolean;
}): Promise<void> {
  const { dependencyInstallPath, packageManager } = workspace;
  if (!dependencyInstallPath || !packageManager) return;
  if (signal?.aborted)
    throw new DyadError("Test run stopped.", DyadErrorKind.UserCancelled);

  const startedAt = Date.now();
  // Every package this one install touches. The manager installs all workspace
  // members from the root and runs each one's lifecycle scripts, so a sibling's
  // dotenv files are as reachable from this install as the app's own.
  const installedPackagePaths = [
    dependencyInstallPath,
    ...(await findWorkspacePackageDirectories(dependencyInstallPath)),
  ];
  let installChild: ChildProcess | undefined;
  // Defaults to "abnormal", so a throw out of the install — which leaves no
  // result to read — settles rather than restores.
  let installEndedNormally = false;
  const installResult = await withWithheldDatabaseEnv(
    withholdDatabaseEnv
      ? [workspace.workspacePath, ...installedPackagePaths]
      : // The install root's and the siblings' own dotenv files are never
        // rewritten by provider isolation, so a monorepo root or sibling script
        // would read live credentials even for a Neon app whose app-level env
        // WAS swapped.
        installedPackagePaths.filter(
          (directory) => directory !== workspace.workspacePath,
        ),
    () =>
      runCleanPackageInstall({
        cwd: dependencyInstallPath,
        packageManager,
        // Unconditional, unlike the file rewrite above. `dotenv` leaves an
        // already-set variable alone, so a `DATABASE_URL` inherited from the
        // shell that launched Dyad would override the isolated value the
        // sandbox wrote — including the Neon branch URL a `prisma migrate` in
        // a lifecycle script is supposed to run against.
        env: getPackageManagerCommandEnv(withoutInheritedDatabaseEnv()),
        signal,
        timeoutMs: DEPENDENCY_INSTALL_TIMEOUT_MS,
        onOutput,
        // The other two run-scoped children (the sandbox server and the Playwright
        // runner) register here for the same reason: `will-quit` cannot await the
        // async abort path, so aborting alone leaves a cold `npm ci` — budgeted at
        // 15 minutes — alive past the quit, holding the sandbox directory as its
        // cwd. That is exactly the state that makes the next launch's orphan sweep
        // fail on Windows.
        onProcess: (child) => {
          installChild = child;
          // Owned by THIS run's signal. A concurrent run for another app has
          // its own barrier, and a global registration would let either one's
          // cleanup kill the other's install.
          trackE2eTestProcess(child, signal);
        },
      }).then((result) => {
        // The install's OWN outcome, not the root process's exit fields. A
        // root that has exited says nothing about a lifecycle descendant it
        // spawned — `npm` forks freely — so keying the barrier on the root
        // would skip it for exactly the case it exists to catch.
        installEndedNormally = !result.aborted && !result.timedOut;
        return result;
      }),
    // On a Stop or a timeout `spawnStreaming` fires `treeKill` and returns
    // immediately, so the install tree can outlive this call. Nothing may
    // restore the live credentials — or delete the workspace afterwards —
    // while a lifecycle script is still running in it.
    async () => {
      // A normal return came from `close`, which fires once the root's stdio
      // has drained: the closest signal Node gives that descendants sharing
      // those pipes are gone. Nothing to kill, and nothing to withhold.
      if (installEndedNormally) return true;
      if (!installChild || installChild.pid === undefined) return true;
      return await forceKillProcessTree(installChild);
    },
  );
  if (installResult.aborted || signal?.aborted) {
    throw new DyadError("Test run stopped.", DyadErrorKind.UserCancelled);
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

/**
 * Artifact directories kept per app when nothing can still reference them.
 *
 * Enough to look back over the last few runs of an app on a fresh launch,
 * bounded enough that a long-lived install cannot accumulate trace files
 * without limit.
 */
const RETAINED_ARTIFACT_RUNS_ON_STARTUP = 5;

/** Drop all but the newest few artifact directories for each app. */
async function removeSupersededArtifactRuns(
  artifactRoot: string,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(artifactRoot, { withFileTypes: true });
  } catch (error) {
    if (!isMissingPathError(error)) {
      logger.warn(`Failed to list retained E2E artifacts: ${error}`);
    }
    return;
  }
  const byApp = new Map<number, { name: string; modifiedAt: number }[]>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // A run this process still owns is never superseded, whatever its timestamp
    // sorts as. The sandbox sweep that runs before this one deletes
    // dependency-heavy trees and can take minutes — long enough for a run to
    // start and retain its artifacts underneath it. The orphan pass below skips
    // active names for the same reason.
    if (activeWorkspaceNames.has(entry.name)) continue;
    const appId = runDirectoryAppId(entry.name);
    if (appId === null) continue;
    // A stat that fails for any reason other than "it is gone" says nothing
    // about age. Treating it as epoch-zero would sort the directory oldest and
    // make it the FIRST thing deleted — the opposite of what an unreadable
    // directory warrants — so it is left out of the ranking, and so out of the
    // prune, entirely.
    const modifiedAt = await fs
      .stat(path.join(artifactRoot, entry.name))
      .then((stat) => stat.mtimeMs)
      .catch((error) => {
        if (!isMissingPathError(error)) {
          logger.warn(
            `Keeping the retained E2E artifacts in ${entry.name}, which could not be read: ${error}`,
          );
        }
        return null;
      });
    if (modifiedAt === null) continue;
    byApp.set(appId, [
      ...(byApp.get(appId) ?? []),
      { name: entry.name, modifiedAt },
    ]);
  }
  const superseded = new Set<string>();
  for (const runs of byApp.values()) {
    runs
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(RETAINED_ARTIFACT_RUNS_ON_STARTUP)
      .forEach((run) => superseded.add(run.name));
  }
  if (superseded.size === 0) return;
  await removeRunDirectories(
    artifactRoot,
    (name) => superseded.has(name),
    "superseded test artifacts",
  );
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
  // In-session pruning only runs after a full run, so a session of targeted
  // runs accumulates directories on purpose — no count chosen in the main
  // process can know which of them a renderer row still points at. Startup is
  // the one moment that constraint lifts: the run state lives in renderer
  // memory and did not survive the restart, so nothing references any of these
  // and the oldest can go. That is what keeps the accumulation bounded across
  // sessions without ever breaking a visible result.
  await removeSupersededArtifactRuns(
    path.join(userDataPath, E2E_TEST_ARTIFACT_DIR),
  );
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
