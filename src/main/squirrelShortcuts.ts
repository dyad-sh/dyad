/**
 * Squirrel.Windows Shortcut Refresh Handler
 *
 * Handles Squirrel installer events (--squirrel-install, --squirrel-updated, etc.)
 * and ensures Desktop/Start Menu shortcuts are refreshed with the correct icon.
 *
 * WHY: Squirrel.Windows can leave stale shortcuts with old icons on updates.
 * The fix is to explicitly remove and recreate shortcuts during install/update events.
 *
 * @see https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/update-process.md
 */

import { spawn } from "child_process";
import * as path from "path";
import log from "electron-log";

// Use path.win32 to ensure consistent Windows path handling,
// even when running tests on Linux/macOS CI.
const winPath = path.win32;

const logger = log.scope("squirrel");

/**
 * Squirrel event types passed via command line arguments.
 */
export type SquirrelEvent =
  | "squirrel-install"
  | "squirrel-updated"
  | "squirrel-uninstall"
  | "squirrel-obsolete"
  | null;

/**
 * Locations where shortcuts can be created/removed.
 */
export const SHORTCUT_LOCATIONS = ["Desktop", "StartMenu"] as const;

/**
 * Detects if the app was launched with a Squirrel event argument.
 * @param argv - Command line arguments (typically process.argv)
 * @returns The Squirrel event type, or null if not a Squirrel event
 */
export function detectSquirrelEvent(argv: string[]): SquirrelEvent {
  const events: SquirrelEvent[] = [
    "squirrel-install",
    "squirrel-updated",
    "squirrel-uninstall",
    "squirrel-obsolete",
  ];

  for (const arg of argv) {
    for (const event of events) {
      if (arg === `--${event}`) {
        return event;
      }
    }
  }
  return null;
}

/**
 * Gets the path to Update.exe relative to the app's executable path.
 * In Squirrel.Windows layout: <app-root>/Update.exe and <app-root>/app-<version>/app.exe
 *
 * @param execPath - The app's executable path (process.execPath)
 * @returns Path to Update.exe
 */
export function getUpdateExePath(execPath: string): string {
  // execPath is like: C:\Users\...\AppData\Local\abba_ai\app-1.0.0\ABBA AI.exe
  // Update.exe is at: C:\Users\...\AppData\Local\abba_ai\Update.exe
  const appDir = winPath.dirname(execPath); // app-1.0.0 directory
  const rootDir = winPath.dirname(appDir); // abba_ai directory
  return winPath.join(rootDir, "Update.exe");
}

/**
 * Gets the executable name from the full path.
 * @param execPath - The app's executable path (process.execPath)
 * @returns The exe filename (e.g., "ABBA AI.exe")
 */
export function getExeName(execPath: string): string {
  return winPath.basename(execPath);
}

/**
 * Builds command line arguments for Update.exe shortcut operations.
 * @param exeName - The app executable name
 * @param operation - "createShortcut" or "removeShortcut"
 * @returns Array of arguments
 */
export function buildShortcutArgs(
  exeName: string,
  operation: "createShortcut" | "removeShortcut",
): string[] {
  const locations = SHORTCUT_LOCATIONS.join(",");
  return [`--${operation}`, exeName, `--shortcut-locations=${locations}`];
}

/**
 * Spawns Update.exe with the given arguments.
 * @param updateExePath - Path to Update.exe
 * @param args - Arguments to pass
 * @returns Promise that resolves with exit code
 */
function spawnUpdate(updateExePath: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    logger.info(`Running: ${updateExePath} ${args.join(" ")}`);

    const child = spawn(updateExePath, args, {
      detached: true,
      stdio: "ignore",
    });

    child.on("error", (err) => {
      logger.error(`Failed to spawn Update.exe:`, err);
      reject(err);
    });

    child.on("close", (code) => {
      logger.info(`Update.exe exited with code: ${code}`);
      resolve(code ?? 0);
    });

    // Don't wait for the child process
    child.unref();
  });
}

/**
 * Refreshes shortcuts by removing and recreating them.
 * This ensures the icon is updated to the current app icon.
 *
 * @param execPath - The app's executable path
 * @returns Promise that resolves when shortcuts are refreshed
 */
export async function refreshShortcuts(execPath: string): Promise<void> {
  const updateExe = getUpdateExePath(execPath);
  const exeName = getExeName(execPath);

  logger.info("Refreshing shortcuts...");
  logger.info(`  Update.exe: ${updateExe}`);
  logger.info(`  Exe name: ${exeName}`);

  // Remove existing shortcuts first
  const removeArgs = buildShortcutArgs(exeName, "removeShortcut");
  try {
    await spawnUpdate(updateExe, removeArgs);
    logger.info("Removed existing shortcuts");
  } catch (err) {
    logger.warn("Failed to remove shortcuts (may not exist):", err);
    // Continue anyway - shortcuts may not exist
  }

  // Small delay to ensure removal completes
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Create new shortcuts with correct icon
  const createArgs = buildShortcutArgs(exeName, "createShortcut");
  try {
    await spawnUpdate(updateExe, createArgs);
    logger.info("Created new shortcuts with updated icon");
  } catch (err) {
    logger.error("Failed to create shortcuts:", err);
    throw err;
  }
}

/**
 * Removes shortcuts on uninstall.
 *
 * @param execPath - The app's executable path
 * @returns Promise that resolves when shortcuts are removed
 */
export async function removeShortcuts(execPath: string): Promise<void> {
  const updateExe = getUpdateExePath(execPath);
  const exeName = getExeName(execPath);

  logger.info("Removing shortcuts for uninstall...");

  const removeArgs = buildShortcutArgs(exeName, "removeShortcut");
  try {
    await spawnUpdate(updateExe, removeArgs);
    logger.info("Removed shortcuts");
  } catch (err) {
    logger.warn("Failed to remove shortcuts:", err);
    // Don't throw - uninstall should continue
  }
}

/**
 * Handles Squirrel.Windows events at app startup.
 * This should be called VERY EARLY in the main process, before app.whenReady().
 *
 * @param app - The Electron app instance
 * @param argv - Command line arguments (process.argv)
 * @returns true if a Squirrel event was handled (app should quit), false otherwise
 */
export async function handleSquirrelEvent(
  app: Electron.App,
  argv: string[],
): Promise<boolean> {
  // Only handle on Windows
  if (process.platform !== "win32") {
    return false;
  }

  const event = detectSquirrelEvent(argv);
  if (!event) {
    return false;
  }

  logger.info(`Handling Squirrel event: ${event}`);
  logger.info(`  execPath: ${process.execPath}`);

  try {
    switch (event) {
      case "squirrel-install":
      case "squirrel-updated":
        // Refresh shortcuts to ensure correct icon
        await refreshShortcuts(process.execPath);
        break;

      case "squirrel-uninstall":
        // Remove shortcuts
        await removeShortcuts(process.execPath);
        break;

      case "squirrel-obsolete":
        // This version is being replaced, just exit
        logger.info("App version is obsolete, exiting");
        break;
    }
  } catch (err) {
    logger.error(`Error handling Squirrel event ${event}:`, err);
    // Continue to quit even on error
  }

  // Give spawned processes time to start
  setTimeout(() => {
    logger.info("Squirrel event handled, quitting app");
    app.quit();
  }, 1000);

  return true;
}
