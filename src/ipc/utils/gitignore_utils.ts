import log from "electron-log";
import ignore, { type Ignore } from "ignore";
import { promises as fs } from "node:fs";
import path from "node:path";

const logger = log.scope("gitignore_utils");

const matcherCache = new Map<string, { mtimeMs: number; matcher: Ignore }>();

async function loadMatcher(gitIgnorePath: string): Promise<Ignore | null> {
  try {
    const stats = await fs.stat(gitIgnorePath);
    const cached = matcherCache.get(gitIgnorePath);
    if (cached?.mtimeMs === stats.mtimeMs) {
      return cached.matcher;
    }

    const matcher = ignore().add(await fs.readFile(gitIgnorePath, "utf-8"));
    matcherCache.set(gitIgnorePath, { mtimeMs: stats.mtimeMs, matcher });
    return matcher;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      matcherCache.delete(gitIgnorePath);
      return null;
    }
    throw error;
  }
}

/**
 * Evaluates root and nested .gitignore files without requiring a Git repo.
 * This is intended for filesystem traversal and sync paths where launching a
 * Git process per candidate would be prohibitively expensive.
 */
export async function isPathIgnoredByGitIgnore({
  basePath,
  filePath,
  isDirectory = false,
}: {
  basePath: string;
  filePath: string;
  isDirectory?: boolean;
}): Promise<boolean> {
  try {
    const relativeToBase = path.relative(basePath, filePath);
    if (
      relativeToBase === "" ||
      relativeToBase === ".." ||
      relativeToBase.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToBase)
    ) {
      return false;
    }

    const pathParts = relativeToBase.split(path.sep);
    let currentDir = basePath;
    let ignored = false;

    // Apply ignore files from the root toward the path. A nested .gitignore
    // overrides earlier rules, matching Git's precedence rules. An ignored
    // directory is never traversed, so its own rules cannot re-include files.
    for (let index = 0; index < pathParts.length; index++) {
      const matcher = await loadMatcher(path.join(currentDir, ".gitignore"));
      if (matcher) {
        const relativePath = path
          .relative(currentDir, filePath)
          .split(path.sep)
          .join("/");
        const result = matcher.test(
          isDirectory ? `${relativePath}/` : relativePath,
        );
        if (result.ignored) ignored = true;
        if (result.unignored) ignored = false;
      }
      currentDir = path.join(currentDir, pathParts[index]);
    }

    return ignored;
  } catch (error) {
    logger.error(`Error checking if path is git ignored: ${filePath}`, error);
    return false;
  }
}
