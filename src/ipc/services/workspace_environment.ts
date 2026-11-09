import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import log from "electron-log";
import { execGit } from "@/ipc/utils/git_utils";

const logger = log.scope("workspace_environment");

/**
 * The `.env*` files Git tracks in `appPath`. Those reach a worktree through
 * Git; copying the app folder's uncommitted edits of one would have the
 * chat commit them.
 */
async function listTrackedEnvironmentFiles(
  appPath: string,
): Promise<Set<string>> {
  try {
    const result = await execGit(
      ["ls-files", "-z", "--", ":(glob).env*"],
      appPath,
    );
    if (result.exitCode === 0) {
      return new Set(result.stdout.split("\0").filter(Boolean));
    }
    logger.warn(`Could not list tracked environment files: ${result.stderr}`);
  } catch (error) {
    logger.warn("Could not list tracked environment files", error);
  }
  return new Set();
}

/**
 * Brings the app's untracked `.env*` files into a chat's worktree: they are
 * gitignored, so they never arrive through Git. A file is copied when the
 * worktree lacks it or the app's copy is newer (the Configure panel or a
 * provider connection rewrote it), so a worktree kept for days still runs
 * with current settings, while a newer edit made inside the worktree is left
 * alone.
 */
export async function syncEnvironmentFiles(
  fromAppPath: string,
  toAppPath: string,
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsPromises.readdir(fromAppPath, { withFileTypes: true });
  } catch {
    return;
  }
  const candidates = entries.filter(
    (entry) => entry.isFile() && entry.name.startsWith(".env"),
  );
  if (candidates.length === 0) return;
  const tracked = await listTrackedEnvironmentFiles(toAppPath);
  for (const entry of candidates) {
    if (tracked.has(entry.name)) continue;
    const source = path.join(fromAppPath, entry.name);
    const destination = path.join(toAppPath, entry.name);
    try {
      const [sourceStat, destinationStat] = await Promise.all([
        fsPromises.stat(source),
        fsPromises.stat(destination).catch(() => null),
      ]);
      if (destinationStat && destinationStat.mtimeMs >= sourceStat.mtimeMs) {
        continue;
      }
      await fsPromises.copyFile(source, destination);
    } catch (error) {
      logger.warn(`Failed to copy ${entry.name} into the workspace`, error);
    }
  }
}
