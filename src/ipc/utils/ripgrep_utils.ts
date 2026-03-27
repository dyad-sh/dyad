/**
 * Shared utilities for ripgrep integration
 */

import path from "node:path";
import os from "node:os";

function getElectronApp(): typeof import("electron")["app"] | null {
  try {
    if (process.versions?.electron) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("electron").app;
    }
  } catch { /* Not in Electron */ }
  return null;
}

export const MAX_FILE_SEARCH_SIZE = 1024 * 1024;
export const RIPGREP_EXCLUDED_GLOBS = [
  "!node_modules/**",
  "!.git/**",
  "!.next/**",
];

/**
 * Get the path to the ripgrep executable.
 * Handles both development and packaged Electron app scenarios.
 */
export function getRgExecutablePath(): string {
  const isWindows = os.platform() === "win32";
  const executableName = isWindows ? "rg.exe" : "rg";
  const app = getElectronApp();
  if (!app || !app.isPackaged) {
    // Dev or web mode: app path is the project root
    const appPath = app?.getAppPath() ?? process.cwd();
    return path.join(
      appPath,
      "node_modules",
      "@vscode",
      "ripgrep",
      "bin",
      executableName,
    );
  }
  // Packaged app: ripgrep is bundled via extraResource
  // Since we extract "node_modules/@vscode/ripgrep", it's at resources/@vscode/ripgrep
  return path.join(
    process.resourcesPath,
    "@vscode",
    "ripgrep",
    "bin",
    executableName,
  );
}
