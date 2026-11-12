import fs from "node:fs";
import path from "node:path";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const PERMISSION_ERROR_CODES = new Set(["EACCES", "EPERM"]);
const MISSING_ERROR_CODES = new Set(["ENOENT", "ENOTDIR"]);

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function statErrorCode(target: string): Promise<string | null> {
  try {
    await fs.promises.stat(target);
    return null;
  } catch (error) {
    return errorCode(error) ?? "UNKNOWN";
  }
}

function permissionError(appPath: string): DyadError {
  return new DyadError(
    `Dyad doesn't have permission to access the app folder '${appPath}'. Check the folder's permissions (on macOS, also check Privacy & Security settings).`,
    DyadErrorKind.Precondition,
  );
}

/**
 * Throws a classified error explaining why the app folder can't be used, given
 * the error code from `stat(appPath)`. Returns for codes it can't explain, so
 * callers fall back to their own error.
 */
async function throwIfAppFolderUnusable(
  appPath: string,
  appDirErrorCode: string,
): Promise<void> {
  if (PERMISSION_ERROR_CODES.has(appDirErrorCode)) {
    throw permissionError(appPath);
  }
  if (MISSING_ERROR_CODES.has(appDirErrorCode)) {
    const parentDir = path.dirname(appPath);
    if ((await statErrorCode(parentDir)) !== null) {
      throw new DyadError(
        `The app's location '${parentDir}' is unavailable. If it's on an external, network, or cloud-synced drive, make sure that drive is connected.`,
        DyadErrorKind.NotFound,
      );
    }
    throw new DyadError(
      `App folder not found: '${appPath}'. It may have been moved or deleted.`,
      DyadErrorKind.NotFound,
    );
  }
}

/**
 * Returns null when `appPath` is a folder, "ENOTDIR" when something else is
 * there, or the `stat` error code.
 */
async function appFolderErrorCode(appPath: string): Promise<string | null> {
  try {
    const stats = await fs.promises.stat(appPath);
    // A file where the app folder should be means the folder is gone.
    return stats.isDirectory() ? null : "ENOTDIR";
  } catch (error) {
    return errorCode(error) ?? "UNKNOWN";
  }
}

/**
 * Asserts that the app folder at `appPath` (an already-resolved app path) is
 * present and accessible, with the same diagnosis as
 * {@link assertAppGitRepository}. Use it before work that would otherwise
 * create files in, or run processes from, a folder the user deleted.
 */
export async function assertAppFolderExists(appPath: string): Promise<void> {
  let appDirErrorCode = await appFolderErrorCode(appPath);
  if (appDirErrorCode === null) {
    try {
      // `stat` succeeds even when the folder itself can't be opened.
      await fs.promises.access(appPath, fs.constants.R_OK | fs.constants.X_OK);
      return;
    } catch (error) {
      appDirErrorCode = errorCode(error) ?? "UNKNOWN";
    }
  }
  await throwIfAppFolderUnusable(appPath, appDirErrorCode);
  throw new DyadError(
    `Dyad couldn't access the app folder '${appPath}' (${appDirErrorCode}).`,
    DyadErrorKind.External,
  );
}

/**
 * Asserts that `appPath` (an already-resolved app path) is a git repository.
 *
 * A missing `.git` entry is usually not a non-git app: Dyad initializes git on
 * create and import. More often the app folder itself was moved or deleted, or
 * lives on a drive or folder that is currently unavailable or not readable.
 * The cause is only diagnosed after the `.git` check fails, so the common path
 * costs a single `stat`. A race between the two checks only changes which
 * message is shown; nothing acts on the diagnosis.
 */
export async function assertAppGitRepository(appPath: string): Promise<void> {
  const gitErrorCode = await statErrorCode(path.join(appPath, ".git"));
  if (gitErrorCode === null) {
    return;
  }
  if (PERMISSION_ERROR_CODES.has(gitErrorCode)) {
    throw permissionError(appPath);
  }

  const appDirErrorCode = await appFolderErrorCode(appPath);
  if (appDirErrorCode !== null) {
    await throwIfAppFolderUnusable(appPath, appDirErrorCode);
  }

  throw new DyadError("Not a git repository", DyadErrorKind.External);
}
