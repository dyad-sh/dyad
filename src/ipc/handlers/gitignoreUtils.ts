import fs from "node:fs";
import path from "node:path";
import { isInsideChatWorkspace } from "@/paths/chat_workspaces";
import {
  findCheckoutRootSync,
  isDyadMetadataExcludedSync,
} from "@/ipc/utils/git_dir";
import { excludeDyadMetadata } from "@/ipc/utils/git_worktree_utils";
import { readSettings } from "@/main/settings";

/**
 * Ensures the given entries are listed in the project's `.gitignore`.
 * Creates `.gitignore` if it doesn't exist.
 */
async function ensureGitignored(
  appPath: string,
  entries: string[],
): Promise<void> {
  const gitignorePath = path.join(appPath, ".gitignore");
  let content = "";
  let exists = true;
  try {
    content = await fs.promises.readFile(gitignorePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    exists = false;
    // .gitignore doesn't exist yet — will be created below
  }

  const lines = content.split(/\r?\n/);
  const missing = entries.filter(
    (entry) =>
      !lines.some(
        (line) =>
          line.trim() === entry || line.trim() === entry.replace(/\/$/, ""),
      ),
  );
  if (missing.length === 0) return;

  const suffix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  await fs.promises.writeFile(
    gitignorePath,
    content + suffix + missing.map((e) => e + "\n").join(""),
    // Windows rejects the default `w` flag for existing hidden/system files.
    // The updated content only grows, so `r+` needs no trailing truncation.
    { encoding: "utf-8", flag: exists ? "r+" : "w" },
  );
}

/**
 * Keeps `.dyad/` out of Git for the app.
 *
 * - Does nothing inside a chat worktree, or when the repository's
 *   `info/exclude` already lists `.dyad/`.
 * - With worktree isolation on, adds `.dyad/` to the repository's
 *   `info/exclude` and leaves `.gitignore` untouched.
 * - Otherwise (or when `info/exclude` cannot be written), adds `.dyad/` to
 *   the app's `.gitignore`, creating it if needed.
 */
export async function ensureDyadGitignored(appPath: string): Promise<void> {
  // With worktree isolation `.dyad/` is excluded through the repository's
  // info/exclude (excludeDyadMetadata), which covers the app's folder and
  // every chat worktree. Editing the tracked .gitignore there anyway leaves
  // an uncommitted change in the app's folder (nothing commits there while
  // chats work in worktrees) or a worktree commit that collides with it,
  // and either blocks merging.
  // From the checkout's root: an app in a subfolder of its repository has
  // no `.git` of its own, and info/exclude is the repository's.
  const checkoutRoot = findCheckoutRootSync(appPath);
  if (
    isInsideChatWorkspace(appPath) ||
    (checkoutRoot !== null && isDyadMetadataExcludedSync(checkoutRoot))
  ) {
    return;
  }
  // Before the app's first worktree exists (an attachment on its first
  // message), exclude it the same way rather than edit .gitignore there.
  // When the repository's Git directory is missing (a linked checkout whose
  // repository moved), fall back to .gitignore: an uncommitted .gitignore
  // edit is better than committing .dyad/.
  if (
    readSettings().enableWorktreeIsolation === true &&
    checkoutRoot &&
    (await excludeDyadMetadata(checkoutRoot))
  ) {
    return;
  }
  await ensureGitignored(appPath, [".dyad/"]);
}
