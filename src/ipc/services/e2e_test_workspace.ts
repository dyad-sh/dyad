import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import log from "electron-log";

import { getUserDataPath } from "@/paths/paths";

const logger = log.scope("e2e_test_workspace");

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
    filter: () => !signal?.aborted,
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

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    assertOwnedPath(sandboxRoot, workspacePath);
    await fs.rm(workspacePath, { recursive: true, force: true });
  };

  try {
    await fs.cp(appPath, workspacePath, {
      recursive: true,
      verbatimSymlinks: true,
      ...(process.platform === "win32"
        ? {}
        : { mode: fsConstants.COPYFILE_FICLONE }),
      filter: (candidatePath) => {
        if (signal?.aborted) return false;
        return shouldCopyE2eWorkspacePath(appPath, candidatePath);
      },
    });
    if (signal?.aborted) throw new Error("Test run stopped.");
    onProgress?.("Cloning installed dependencies into the test workspace…\n");
    await copyNodeModules(appPath, workspacePath, signal);
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

export async function reconcileOrphanE2eTestWorkspaces(): Promise<void> {
  const sandboxRoot = path.join(getUserDataPath(), E2E_TEST_SANDBOX_DIR);
  try {
    await fs.rm(sandboxRoot, { recursive: true, force: true });
  } catch (error) {
    logger.warn(`Failed to remove abandoned E2E test workspaces: ${error}`);
  }
}
