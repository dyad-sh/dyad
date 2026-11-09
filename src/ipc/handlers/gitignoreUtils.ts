import fs from "node:fs";
import path from "node:path";
import { isInsideChatWorkspace } from "@/paths/chat_workspaces";
import { isDyadMetadataExcludedSync } from "@/ipc/utils/git_dir";
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
 * Ensures `.dyad/` is listed in the project's `.gitignore`.
 * Creates `.gitignore` if it doesn't exist.
 */
export async function ensureDyadGitignored(appPath: string): Promise<void> {
  // With worktree isolation `.dyad/` is excluded through the repository's
  // info/exclude (excludeDyadMetadata), which covers the app's folder and
  // every chat worktree. Editing the tracked .gitignore there anyway leaves
  // an uncommitted change in the app's folder (nothing commits there while
  // chats work in worktrees) or a worktree commit that collides with it,
  // and either blocks merging.
  if (isInsideChatWorkspace(appPath) || isDyadMetadataExcludedSync(appPath)) {
    return;
  }
  // Before the app's first worktree exists (an attachment on its first
  // message), exclude it the same way rather than edit .gitignore there.
  if (
    readSettings().enableWorktreeIsolation === true &&
    fs.existsSync(path.join(appPath, ".git"))
  ) {
    await excludeDyadMetadata(appPath);
    return;
  }
  await ensureGitignored(appPath, [".dyad/"]);
}
