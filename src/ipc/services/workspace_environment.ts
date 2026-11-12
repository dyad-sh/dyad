import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import log from "electron-log";
import { execGit } from "@/ipc/utils/git_utils";

const logger = log.scope("workspace_environment");

const ENVIRONMENT_PATHSPEC = ":(glob).env*";

function splitNulSeparated(stdout: string): string[] {
  return stdout.split("\0").filter(Boolean);
}

/**
 * The `.env*` files Git tracks or has staged in `appPath`, including ones
 * whose deletion is staged, or `null` when Git could not say. Those reach a
 * worktree through Git; copying the app folder's uncommitted edits of one
 * would have the chat commit them, and copying one back over a staged
 * deletion would undo it.
 */
async function listTrackedEnvironmentFiles(
  appPath: string,
): Promise<Set<string> | null> {
  try {
    const [indexed, stagedDeletions] = await Promise.all([
      execGit(["ls-files", "-z", "--", ENVIRONMENT_PATHSPEC], appPath),
      execGit(
        [
          "diff",
          "--cached",
          "--name-only",
          "--relative",
          "--diff-filter=D",
          "-z",
          "--",
          ENVIRONMENT_PATHSPEC,
        ],
        appPath,
      ),
    ]);
    if (indexed.exitCode === 0 && stagedDeletions.exitCode === 0) {
      return new Set([
        ...splitNulSeparated(indexed.stdout),
        ...splitNulSeparated(stagedDeletions.stdout),
      ]);
    }
    logger.warn(
      `Could not list tracked environment files: ${indexed.stderr || stagedDeletions.stderr}`,
    );
  } catch (error) {
    logger.warn("Could not list tracked environment files", error);
  }
  return null;
}

/**
 * Which of `names` the worktree's Git ignores, or `null` when Git could not
 * say. A `.env*` file the worktree does not ignore (a plain `.env` is not
 * covered by the scaffold's `*.local` rule) would be committed by the chat's
 * next turn, secrets and all.
 */
async function listIgnoredEnvironmentFiles(
  appPath: string,
  names: string[],
): Promise<Set<string> | null> {
  try {
    // Exit code 1 means none of the paths is ignored.
    const result = await execGit(["check-ignore", "-z", "--stdin"], appPath, {
      stdin: names.map((name) => `${name}\0`).join(""),
    });
    if (result.exitCode === 0 || result.exitCode === 1) {
      return new Set(splitNulSeparated(result.stdout));
    }
    logger.warn(`Could not check ignored environment files: ${result.stderr}`);
  } catch (error) {
    logger.warn("Could not check ignored environment files", error);
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
 * Only files the worktree's Git ignores are copied: one it does not ignore
 * would be committed by the chat. A file either checkout tracks or has staged
 * (a staged deletion included) is never copied, and nothing is copied when
 * Git cannot tell. Only regular files are written, never through a symlink in
 * the worktree.
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
  const [trackedInApp, trackedInWorkspace, ignoredInWorkspace] =
    await Promise.all([
      listTrackedEnvironmentFiles(fromAppPath),
      listTrackedEnvironmentFiles(toAppPath),
      listIgnoredEnvironmentFiles(
        toAppPath,
        candidates.map((entry) => entry.name),
      ),
    ]);
  if (!trackedInApp || !trackedInWorkspace || !ignoredInWorkspace) {
    logger.warn(
      "Not copying environment files into the workspace: could not tell which ones Git tracks or ignores",
    );
    return;
  }
  for (const entry of candidates) {
    if (trackedInApp.has(entry.name) || trackedInWorkspace.has(entry.name)) {
      continue;
    }
    if (!ignoredInWorkspace.has(entry.name)) {
      logger.info(
        `Not copying ${entry.name} into the workspace: the workspace's Git does not ignore it, so the chat would commit it`,
      );
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
