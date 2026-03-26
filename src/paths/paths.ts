import path from "node:path";
import os from "node:os";
import { IS_TEST_BUILD } from "../ipc/utils/test_utils";

/**
 * Gets the base proteaai-apps directory path (without a specific app subdirectory).
 * In web mode with a userId, returns a per-user subdirectory to isolate data.
 */
export function getProteaAIAppsBaseDirectory(userId?: string): string {
  if (IS_TEST_BUILD) {
    const electron = getElectron();
    const base = path.join(electron!.app.getPath("userData"), "proteaai-apps");
    return userId ? path.join(base, userId) : base;
  }
  const base = path.join(os.homedir(), "proteaai-apps");
  // In web mode, scope apps per-user if a userId is provided
  if (userId && !process.versions?.electron) {
    return path.join(base, userId);
  }
  return base;
}

export function getProteaAIAppPath(appPath: string, userId?: string): string {
  // If appPath is already absolute, use it as-is
  if (path.isAbsolute(appPath)) {
    return appPath;
  }
  // Otherwise, use the default base path (per-user in web mode)
  return path.join(getProteaAIAppsBaseDirectory(userId), appPath);
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
