import log from "electron-log";
import ignore from "ignore";
import { promises as fs } from "node:fs";
import path from "node:path";

const logger = log.scope("gitignore_utils");

// Caches the anchored pattern lines parsed from a single .gitignore file.
// Patterns are anchored to the .gitignore's directory relative to `basePath`
// so that rules from root and nested .gitignore files can be combined into a
// single `Ignore` instance, which is required for Git-correct composition of
// a child's directory re-include (e.g. root `dist/` + nested `!dist/`).
//
// The cache key includes the relative directory because the same .gitignore
// file is anchored differently depending on the caller's `basePath`.
const patternCache = new Map<string, { mtimeMs: number; patterns: string[] }>();

async function loadAnchoredPatterns(
  gitIgnorePath: string,
  relDir: string,
): Promise<string[] | null> {
  try {
    const stats = await fs.stat(gitIgnorePath);
    const cacheKey = `${gitIgnorePath}\0${relDir}`;
    const cached = patternCache.get(cacheKey);
    if (cached?.mtimeMs === stats.mtimeMs) {
      return cached.patterns;
    }

    const content = await fs.readFile(gitIgnorePath, "utf-8");
    const patterns = anchorGitignoreContent(content, relDir);
    patternCache.set(cacheKey, { mtimeMs: stats.mtimeMs, patterns });
    return patterns;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      patternCache.delete(`${gitIgnorePath}\0${relDir}`);
      return null;
    }
    throw error;
  }
}

/**
 * Rewrites each pattern line of a .gitignore located at `relDir` (relative to
 * `basePath`, `""` for the root) so every rule is scoped to `relDir`'s
 * subtree. The rewritten lines are intended to be combined with those of
 * other .gitignore files in a single `Ignore` instance.
 *
 * Git scopes a .gitignore's patterns to its containing directory: patterns
 * with no slash (other than a trailing one) match at any depth below it,
 * while patterns with a leading or internal slash are anchored at it. We
 * reproduce that scoping by prefixing each pattern with the directory it
 * applies to, so a child .gitignore can re-include a directory that an
 * ancestor excluded (e.g. root `dist/` + `app/.gitignore` `!dist/`), which the
 * `ignore` package only composes correctly within a single instance. Splitting
 * the per-file rules across separate instances loses the child's directory
 * un-ignore for the files inside it, because each instance applies Git's
 * "a file under an ignored directory cannot be re-included" rule to its own
 * rules only.
 */
function anchorGitignoreContent(content: string, relDir: string): string[] {
  const anchored: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine;
    if (line === "" || /^[\t ]+$/.test(line) || line.startsWith("#")) {
      continue;
    }

    let negated = false;
    let body = line;
    if (body.startsWith("!")) {
      negated = true;
      body = body.slice(1);
    }

    // The `ignore` package strips trailing unescaped whitespace before
    // matching; do the same here so a trailing slash stays detectable.
    body = body.replace(/[\t ]+$/, "");

    const trailingSlash = body.endsWith("/");
    if (trailingSlash) {
      body = body.slice(0, -1);
    }

    if (body === "") {
      continue;
    }

    let scoped: string;
    if (body.startsWith("/")) {
      // A leading slash roots the pattern at the .gitignore's directory.
      scoped = relDir === "" ? body.slice(1) : `${relDir}/${body.slice(1)}`;
    } else if (body.includes("/")) {
      // An internal slash (other than a trailing one) also anchors the
      // pattern at the .gitignore's directory.
      scoped = relDir === "" ? body : `${relDir}/${body}`;
    } else {
      // No slash: the pattern matches at any depth below the .gitignore's
      // directory.
      scoped = relDir === "" ? `**/${body}` : `${relDir}/**/${body}`;
    }

    if (trailingSlash) {
      scoped += "/";
    }

    anchored.push(`${negated ? "!" : ""}${scoped}`);
  }
  return anchored;
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
    const combined = ignore();
    let currentDir = basePath;
    let currentRelDir = "";

    // Combine every .gitignore's patterns from the root toward the path into a
    // single `Ignore` instance so a child directory re-include (e.g. `!dist/`)
    // can lift an ancestor's directory exclude (`dist/`) for the files inside
    // it, matching `git check-ignore`.
    //
    // Before descending into a child directory, verify that Git would enter
    // it at all: a path under a truly-ignored directory cannot be re-included,
    // and skipping the descent avoids loading descendant .gitignore files
    // that Git would never read.
    for (let index = 0; index < pathParts.length; index++) {
      const patterns = await loadAnchoredPatterns(
        path.join(currentDir, ".gitignore"),
        currentRelDir,
      );
      if (patterns && patterns.length > 0) {
        combined.add(patterns);
      }

      const relPath = pathParts.slice(0, index + 1).join("/");

      if (index === pathParts.length - 1) {
        return combined.test(isDirectory ? `${relPath}/` : relPath).ignored;
      }

      if (combined.test(`${relPath}/`).ignored) {
        return true;
      }

      currentDir = path.join(currentDir, pathParts[index]);
      currentRelDir = relPath;
    }

    return false;
  } catch (error) {
    logger.error(`Error checking if path is git ignored: ${filePath}`, error);
    return false;
  }
}
