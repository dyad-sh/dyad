import path from "node:path";
import os from "node:os";

export function getDyadAppPath(appPath: string): string {
  return path.join(os.homedir(), "dyad-apps", appPath);
}

/**
 * Gets the user data path, handling both Electron and non-Electron environments
 * In Electron: returns the app's userData directory
 * In non-Electron: returns "./userData" in the current directory
 */

export function getUserDataPath(): string {
  const electron = getElectron();

  // When running in Electron and app is ready
  if (process.env.NODE_ENV !== "development") {
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
  } catch (e) {
    // Not in Electron environment
  }
  return electron;
}
