import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import log from "electron-log";
import { execGit } from "@/ipc/utils/git_utils";

const logger = log.scope("workspace_environment");

/**
 * The `.env*` files Git tracks (or has staged) in `appPath`, or `null` when
 * Git could not say. Those reach a worktree through Git; copying the app
 * folder's uncommitted edits of one would have the chat commit them.
 */
async function listTrackedEnvironmentFiles(
  appPath: string,
): Promise<Set<string> | null> {
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
  return null;
}

/**
 * Brings the app's untracked `.env*` files into a chat's worktree: they are
 * gitignored, so they never arrive through Git. A file is copied when the
 * worktree lacks it or the app's copy is newer (the Configure panel or a
 * provider connection rewrote it), so a worktree kept for days still runs
 * with current settings, while a newer edit made inside the worktree is left
 * alone.
 *
 * A file either checkout tracks or has staged is never copied, and nothing
 * is copied when Git cannot list them: a copied tracked file would be
 * committed by the chat. Only regular files are written, never through a
 * symlink in the worktree.
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
  const [trackedInApp, trackedInWorkspace] = await Promise.all([
    listTrackedEnvironmentFiles(fromAppPath),
    listTrackedEnvironmentFiles(toAppPath),
  ]);
  if (!trackedInApp || !trackedInWorkspace) {
    logger.warn(
      "Not copying environment files into the workspace: could not tell which ones Git tracks",
    );
    return;
  }
  for (const entry of candidates) {
    if (trackedInApp.has(entry.name) || trackedInWorkspace.has(entry.name)) {
      continue;
    }
    const source = path.join(fromAppPath, entry.name);
    const destination = path.join(toAppPath, entry.name);
    try {
      const [sourceStat, destinationStat] = await Promise.all([
        fsPromises.stat(source),
        fsPromises.lstat(destination).catch(() => null),
      ]);
      if (destinationStat && !destinationStat.isFile()) {
        logger.warn(
          `Not copying ${entry.name} into the workspace: the workspace has a non-file entry there`,
        );
        continue;
      }
      if (destinationStat && destinationStat.mtimeMs >= sourceStat.mtimeMs) {
        continue;
      }
      await fsPromises.copyFile(source, destination);
    } catch (error) {
      logger.warn(`Failed to copy ${entry.name} into the workspace`, error);
    }
  }
}
