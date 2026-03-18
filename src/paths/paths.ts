import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { IS_TEST_BUILD } from "../ipc/utils/test_utils";
import { readSettings } from "../main/settings";

// Cached result of getDyadAppsBaseDirectory
let cachedBaseDirectory: string | null = null;
let cachedCustomFolderSetting: string | null | undefined;
// Whether `dyad-apps` has been created
let defaultDirCreated = false;

/**
 * Gets the default path of the base dyad-apps directory (without a specific app subdirectory)
 */
export function getDefaultDyadAppsDirectory(): string {
  if (IS_TEST_BUILD) {
    const electron = getElectron();
    return path.join(electron!.app.getPath("userData"), "dyad-apps");
  }
  return path.join(os.homedir(), "dyad-apps");
}

/**
 * Gets the default path of the base dyad-apps directory (without a specific app subdirectory),
 * but creates the directory the first time that this function is called
 */
function resolveDefaultDyadAppsDirectory(): string {
  const defaultDir = getDefaultDyadAppsDirectory();
  if (!defaultDirCreated) {
    try {
      fs.mkdirSync(defaultDir, { recursive: true });
      defaultDirCreated = true;
    } catch {
      // Fall through; if it fails then the user will see error toasts
      // when they try to do anything meaningful, but we don't want Dyad to crash
    }
  }
  return defaultDir;
}

/**
 * Clears base directory cache, so the next call to getDyadAppsBaseDirectory will re-read the settings
 */
export function invalidateDyadAppsBaseDirectoryCache(): void {
  cachedBaseDirectory = null;
  cachedCustomFolderSetting = undefined;
}

/**
 * Returns the cached value of the custom folder path
 */
export function getCustomFolderCache(): string | null | undefined {
  return cachedCustomFolderSetting;
}

/**
 * Gets the user's preferred apps directory path (without a specific app subdirectory)
 */
export function getDyadAppsBaseDirectory(): string {
  const appsPath =
    cachedBaseDirectory ??
    (cachedCustomFolderSetting = readSettings().customAppsFolder) ??
    resolveDefaultDyadAppsDirectory();

  cachedBaseDirectory = appsPath;
  return cachedBaseDirectory;
}

/**
 * Given a path, determines whether that path exists, is a directory, and is writable.
 * Can determine, for example, whether the output of `getDyadAppsBaseDirectory` is usable
 */
export function isDirectoryAccessible(directoryPath: string): boolean {
  try {
    const st = fs.statSync(directoryPath);
    if (!st.isDirectory()) return false;
    fs.accessSync(directoryPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function getDyadAppPath(appPath: string): string {
  // If appPath is already absolute, use it as-is
  if (path.isAbsolute(appPath)) {
    return appPath;
  }
  // Otherwise, use the user's preferred base path
  return path.join(getDyadAppsBaseDirectory(), appPath);
}

/**
 * Given an app path, determines whether that path is accessible within the filesystem.
 * The input to this function is assumed to be the result of `getDyadAppPath`.
 */
export function isAppLocationAccessible(resolvedPath: string): boolean {
  const containingFolder = path.dirname(resolvedPath);
  return isDirectoryAccessible(containingFolder);
}

export function getTypeScriptCachePath(): string {
  const electron = getElectron();
  return path.join(electron!.app.getPath("sessionData"), "typescript-cache");
}

/**
 * Gets the user data path, handling both Electron and non-Electron environments
 * In Electron: returns the app's userData directory
 * In non-Electron: returns "./userData" in the current directory
 */

export function getUserDataPath(): string {
  const electron = getElectron();

  // When running in Electron and app is ready
  if (process.env.NODE_ENV !== "development" && electron) {
    return electron!.app.getPath("userData");
  }

  // For development or when the Electron app object isn't available
  return path.resolve("./userData");
}

/**
 * Get a reference to electron in a way that won't break in non-electron environments
 */
export function getElectron(): typeof import("electron") | undefined {
  let electron: typeof import("electron") | undefined;
  try {
    // Check if we're in an Electron environment
    if (process.versions.electron) {
      electron = require("electron");
    }
  } catch {
    // Not in Electron environment
  }
  return electron;
}
