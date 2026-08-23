import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import log from "electron-log";

import { getUserDataPath } from "@/paths/paths";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";

const logger = log.scope("e2e_test_workspace");

// COPYFILE_FICLONE only clones on reflink-capable filesystems (APFS, btrfs,
// XFS); on ext4 and on Windows — where the mode isn't passed at all — this
// degrades to a full byte-for-byte copy of the app and its dependency tree on
// every run. Report timings and entry counts (never absolute paths) so the cost
// on non-reflink filesystems is measurable in the field.
const REFLINK_REQUESTED = process.platform !== "win32";

const EXCLUDED_ROOTS = new Set([
  ".git",
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
  dispose(): Promise<void>;
}

export function shouldCopyE2eWorkspacePath(
  appPath: string,
  candidatePath: string,
): boolean {
  const relative = path.relative(appPath, candidatePath);
  if (!relative) return true;
  const [root] = relative.split(path.sep);
  return root !== ".DS_Store" && !EXCLUDED_ROOTS.has(root);
}

function assertOwnedPath(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove path outside the E2E workspace root.`);
  }
}

async function copyNodeModules(
  appPath: string,
  workspacePath: string,
  signal?: AbortSignal,
  countEntry?: () => void,
) {
  const source = path.join(appPath, "node_modules");
  try {
    const stat = await fs.stat(source);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(
      "The app's dependencies are not installed. Start the app successfully before running tests.",
    );
  }

  // Do not link the node_modules root to the real app. Vite resolves that root
  // symlink before applying its filesystem allowlist; Nitro's server entry then
  // appears to live outside the sandbox and fails with ERR_LOAD_URL. A reflink
  // keeps package files copy-on-write while preserving pnpm's *relative* links
  // inside a sandbox-local dependency tree.
  await fs.cp(source, path.join(workspacePath, "node_modules"), {
    recursive: true,
    verbatimSymlinks: true,
    ...(process.platform === "win32"
      ? {}
      : { mode: fsConstants.COPYFILE_FICLONE }),
    filter: () => {
      if (signal?.aborted) return false;
      countEntry?.();
      return true;
    },
  });
  if (signal?.aborted) throw new Error("Test run stopped.");
}

export async function createE2eTestWorkspace({
  appId,
  appPath,
  signal,
  onProgress,
}: {
  appId: number;
  appPath: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<E2eTestWorkspace> {
  if (signal?.aborted) throw new Error("Test run stopped.");

  const sandboxRoot = path.join(getUserDataPath(), E2E_TEST_SANDBOX_DIR);
  const artifactRoot = path.join(getUserDataPath(), E2E_TEST_ARTIFACT_DIR);
  await Promise.all([
    fs.mkdir(sandboxRoot, { recursive: true }),
    fs.mkdir(artifactRoot, { recursive: true }),
  ]);
  const oldArtifacts = await fs.readdir(artifactRoot, { withFileTypes: true });
  await Promise.all(
    oldArtifacts
      .filter(
        (entry) => entry.isDirectory() && entry.name.startsWith(`${appId}-`),
      )
      .map((entry) =>
        fs.rm(path.join(artifactRoot, entry.name), {
          recursive: true,
          force: true,
        }),
      ),
  );

  const runName = `${appId}-${Date.now()}-${randomUUID()}`;
  const workspacePath = path.join(sandboxRoot, runName);
  const artifactPath = path.join(artifactRoot, runName);
  assertOwnedPath(sandboxRoot, workspacePath);
  assertOwnedPath(artifactRoot, artifactPath);
  // Claim the run directory before the first byte is copied so a concurrent
  // orphan sweep already sees it as live.
  activeWorkspaceNames.add(runName);

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    assertOwnedPath(sandboxRoot, workspacePath);
    const startedAt = Date.now();
    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
      sendTelemetryEvent("e2e_test_workspace_disposed", {
        duration_ms: Date.now() - startedAt,
        platform: process.platform,
      });
    } finally {
      activeWorkspaceNames.delete(runName);
    }
  };

  let sourceEntries = 0;
  let dependencyEntries = 0;
  const startedAt = Date.now();
  try {
    await fs.cp(appPath, workspacePath, {
      recursive: true,
      verbatimSymlinks: true,
      ...(process.platform === "win32"
        ? {}
        : { mode: fsConstants.COPYFILE_FICLONE }),
      filter: (candidatePath) => {
        if (signal?.aborted) return false;
        if (!shouldCopyE2eWorkspacePath(appPath, candidatePath)) return false;
        sourceEntries += 1;
        return true;
      },
    });
    if (signal?.aborted) throw new Error("Test run stopped.");
    const sourceMs = Date.now() - startedAt;
    onProgress?.("Cloning installed dependencies into the test workspace…\n");
    await copyNodeModules(appPath, workspacePath, signal, () => {
      dependencyEntries += 1;
    });
    sendTelemetryEvent("e2e_test_workspace_created", {
      duration_ms: Date.now() - startedAt,
      source_ms: sourceMs,
      dependencies_ms: Date.now() - startedAt - sourceMs,
      source_entries: sourceEntries,
      dependency_entries: dependencyEntries,
      reflink_requested: REFLINK_REQUESTED,
      platform: process.platform,
    });
    return { workspacePath, artifactPath, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export async function retainE2eTestArtifacts({
  workspacePath,
  artifactPath,
}: Pick<E2eTestWorkspace, "workspacePath" | "artifactPath">): Promise<void> {
  const source = path.join(workspacePath, "test-results");
  try {
    if (!(await fs.stat(source)).isDirectory()) return;
  } catch {
    return;
  }
  await fs.rm(artifactPath, { recursive: true, force: true });
  await fs.mkdir(artifactPath, { recursive: true });
  await fs.cp(source, path.join(artifactPath, "test-results"), {
    recursive: true,
    verbatimSymlinks: false,
  });
}

export function rewriteE2eArtifactPath(
  screenshotPath: string | undefined,
  workspacePath: string,
  artifactPath: string,
): string | undefined {
  if (!screenshotPath) return undefined;
  const absolute = path.isAbsolute(screenshotPath)
    ? path.resolve(screenshotPath)
    : path.resolve(workspacePath, screenshotPath);
  const relative = path.relative(workspacePath, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return path.join(artifactPath, relative);
}

/** Run directory names start with `<appId>-`; recover the id from one. */
function runDirectoryAppId(name: string): number | null {
  const [prefix] = name.split("-");
  const appId = Number(prefix);
  return prefix !== "" && Number.isInteger(appId) ? appId : null;
}

async function removeRunDirectories(
  root: string,
  shouldRemove: (name: string) => boolean,
  label: string,
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
    if (!shouldRemove(entry.name)) continue;
    const runPath = path.join(root, entry.name);
    try {
      assertOwnedPath(root, runPath);
      await fs.rm(runPath, { recursive: true, force: true });
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
 * fire-and-forget from startup and removing a multi-gigabyte tree is not
 * instantaneous, so a Run pressed right after launch would otherwise be deleted
 * mid-copy and surface as an unexplained ENOENT.
 *
 * Artifacts are otherwise only replaced by the next run of the same app, so
 * without `knownAppIds` a deleted app's screenshots and traces would sit in
 * user data forever with no surface that shows they exist.
 */
export async function reconcileOrphanE2eTestWorkspaces({
  knownAppIds,
}: { knownAppIds?: ReadonlySet<number> } = {}): Promise<void> {
  const userDataPath = getUserDataPath();
  await removeRunDirectories(
    path.join(userDataPath, E2E_TEST_SANDBOX_DIR),
    (name) => !activeWorkspaceNames.has(name),
    "test workspaces",
  );
  if (!knownAppIds) return;
  await removeRunDirectories(
    path.join(userDataPath, E2E_TEST_ARTIFACT_DIR),
    (name) => {
      const appId = runDirectoryAppId(name);
      // An unparseable name isn't ours to interpret; leave it alone.
      return appId !== null && !knownAppIds.has(appId);
    },
    "test artifacts",
  );
}
