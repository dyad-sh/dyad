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
    const matchers: Array<{ basePath: string; matcher: Ignore }> = [];

    const evaluatePath = (targetPath: string, targetIsDirectory: boolean) => {
      let ignored = false;
      for (const entry of matchers) {
        const relativePath = path
          .relative(entry.basePath, targetPath)
          .split(path.sep)
          .join("/");
        const result = entry.matcher.test(
          targetIsDirectory ? `${relativePath}/` : relativePath,
        );
        if (result.ignored) ignored = true;
        if (result.unignored) ignored = false;
      }
      return ignored;
    };

    // Apply ignore files from the root toward the path. Before loading rules
    // from a child directory, verify that Git would enter that directory at
    // all. A nested negation cannot re-include files below an ignored parent.
    for (let index = 0; index < pathParts.length; index++) {
      const matcher = await loadMatcher(path.join(currentDir, ".gitignore"));
      if (matcher) {
        matchers.push({ basePath: currentDir, matcher });
      }

      if (index === pathParts.length - 1) {
        return evaluatePath(filePath, isDirectory);
      }

      const childDirectory = path.join(currentDir, pathParts[index]);
      if (evaluatePath(childDirectory, true)) {
        return true;
      }
      currentDir = childDirectory;
    }

    return false;
  } catch (error) {
    logger.error(`Error checking if path is git ignored: ${filePath}`, error);
    return false;
  }
}
