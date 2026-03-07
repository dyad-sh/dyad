import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { IS_TEST_BUILD } from "../ipc/utils/test_utils";
import { readSettings } from "../main/settings";

// Cached result of getDyadAppsBaseDirectory
let cachedBaseDirectory: {
  path: string;
  defaultPath: string;
  customPathStatus: "unset" | "unavailable" | "available";
} | null = null;

/**
 * Gets the default path of the base dyad-apps directory (without a specific app subdirectory)
 */
function getDefaultDyadAppsDirectory(): string {
  if (IS_TEST_BUILD) {
    const electron = getElectron();
    return path.join(electron!.app.getPath("userData"), "dyad-apps");
  }
  return path.join(os.homedir(), "dyad-apps");
}

/**
 * Clears base directory cache, so the next call to getDyadAppsBaseDirectory will re-read the settings
 */
export function invalidateDyadAppsBaseDirectoryCache(): void {
  cachedBaseDirectory = null;
}

/**
 * Gets the base dyad-apps directory path (without a specific app subdirectory)
 * For convenience, also returns:
 * - The default path of dyad-apps (e.g. ~/dyad-apps), and
 * - A "status"; whether a custom path has been set, and if that folder is accessible
 */
export function getDyadAppsBaseDirectory(): {
  path: string;
  defaultPath: string;
  customPathStatus: "unset" | "unavailable" | "available";
} {
  if (cachedBaseDirectory) {
    return cachedBaseDirectory;
  }

  const defaultPath = getDefaultDyadAppsDirectory();

  // If the user has not set a custom base directory, use default
  const customPath = readSettings().customDyadAppsBaseDirectory;
  if (!customPath) {
    cachedBaseDirectory = {
      path: defaultPath,
      defaultPath,
      customPathStatus: "unset",
    };
    return cachedBaseDirectory;
  }

  let st;
  try {
    st = fs.statSync(customPath);
  } catch {
    // Setting up to check defaultDir's existence+type, so fall through
  }

  cachedBaseDirectory = {
    path: customPath,
    defaultPath,
    customPathStatus: !st || !st.isDirectory() ? "unavailable" : "available",
  };
  return cachedBaseDirectory;
}

export function getDyadAppPath(appPath: string): string {
  // If appPath is already absolute, use it as-is
  if (path.isAbsolute(appPath)) {
    return appPath;
  }
  // Otherwise, use the user's preferred base path
  return path.join(getDyadAppsBaseDirectory().path, appPath);
}

export function getAvailableDyadAppPath(appPath: string): {
  path: string;
  isFallback: boolean;
} {
  // If appPath is already absolute, use it as-is
  if (path.isAbsolute(appPath)) {
    return { path: appPath, isFallback: false };
  }

  const {
    path: customPath,
    defaultPath,
    customPathStatus,
  } = getDyadAppsBaseDirectory();

  // Return fallback path if a custom path is set but not accessible
  if (customPathStatus === "unavailable") {
    return { path: path.join(defaultPath, appPath), isFallback: true };
  }

  return { path: path.join(customPath, appPath), isFallback: false };
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
