import fs from "node:fs";
import path from "node:path";

/**
 * Resolve the directory that holds a checkout's own Git state (HEAD, index,
 * MERGE_HEAD, rebase state) without spawning Git.
 *
 * In a primary checkout `.git` is that directory. In a linked worktree `.git`
 * is a file containing `gitdir: <path>` that points at
 * `<common>/.git/worktrees/<name>`, which is where that worktree's merge and
 * rebase markers live. Joining marker names onto `<path>/.git` would silently
 * report "no merge in progress" for every linked worktree.
 */
export function resolveGitDirSync(repositoryPath: string): string {
  const dotGit = path.join(repositoryPath, ".git");
  try {
    if (fs.statSync(dotGit).isFile()) {
      const match = /^gitdir:\s*(.+?)\s*$/m.exec(
        fs.readFileSync(dotGit, "utf8"),
      );
      if (match) {
        return path.isAbsolute(match[1])
          ? match[1]
          : path.resolve(repositoryPath, match[1]);
      }
    }
  } catch {
    // Missing or unreadable `.git`: fall back to the conventional location so
    // callers keep their existing "no marker found" behavior.
  }
  return dotGit;
}

/**
 * Resolve the directory shared by every worktree of a repository (config,
 * refs, objects). For a linked worktree, its own Git directory records the
 * shared one in a `commondir` file relative to itself.
 */
export function resolveGitCommonDirSync(repositoryPath: string): string {
  const gitDir = resolveGitDirSync(repositoryPath);
  try {
    const commonDir = fs
      .readFileSync(path.join(gitDir, "commondir"), "utf8")
      .trim();
    if (commonDir) {
      return path.isAbsolute(commonDir)
        ? commonDir
        : path.resolve(gitDir, commonDir);
    }
  } catch {
    // A primary checkout has no `commondir`: its Git directory is shared.
  }
  return gitDir;
}
