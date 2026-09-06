import fs from "node:fs";
import path from "node:path";

/**
 * Reduces a gitignore pattern to its base-name form for equality comparison.
 * Strips a leading slash (repo-root anchor), a trailing slash (directory
 * marker), and a trailing `/*` or `/**` glob that targets all of a
 * directory's contents. `/.dyad/`, `.dyad`, `.dyad/*`, and `/.dyad/**` all
 * normalize to `.dyad`.
 *
 * This is intentionally not a full gitignore parser; it only collapses the
 * common forms equivalent (for "is this directory already ignored at the
 * repo root") to the canonical `<entry>/` form. Ambiguous patterns are left
 * un-matched so the entry is treated as missing rather than silently
 * mis-handled.
 */
function normalizePattern(pattern: string): string {
  return pattern
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+\*+$/, "")
    .replace(/\/+$/, "");
}

/**
 * Returns true if a single non-negated, non-comment line is a gitignore
 * pattern that already ignores `<entryDir>` (the directory at the repo
 * root) or all of its contents.
 */
function isCoveringPattern(line: string, entryDir: string): boolean {
  const t = line.trim();
  if (t === "" || t.startsWith("#") || t.startsWith("!")) return false;
  return normalizePattern(t) === entryDir;
}

/**
 * Returns true if any line is a negation (`!...`) targeting `<entryDir>` or a
 * path beneath it. Appending `<entryDir>/` excludes the parent directory,
 * which per git's "last matching pattern wins" semantics would silently
 * override such a selective un-ignore, so callers must refuse to append when
 * this returns true.
 */
function hasNegationFor(lines: string[], entryDir: string): boolean {
  return lines.some((line) => {
    const t = line.trim();
    if (!t.startsWith("!")) return false;
    const base = normalizePattern(t.slice(1));
    return base === entryDir || base.startsWith(`${entryDir}/`);
  });
}

/**
 * Ensures the given entries are listed in the project's `.gitignore`.
 * Creates `.gitignore` if it doesn't exist. Recognizes git-equivalent covering
 * patterns (anchored, glob) so redundant lines are not appended, and never
 * appends an entry when the file already contains a selective un-ignore
 * (`!...`) negation targeting that directory.
 */
async function ensureGitignored(
  appPath: string,
  entries: string[],
): Promise<void> {
  const gitignorePath = path.join(appPath, ".gitignore");
  let content = "";
  try {
    content = await fs.promises.readFile(gitignorePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // .gitignore doesn't exist yet — will be created below
  }

  const lines = content.split(/\r?\n/);
  const missing = entries.filter((entry) => {
    const entryDir = normalizePattern(entry);
    if (lines.some((line) => isCoveringPattern(line, entryDir))) return false;
    return !hasNegationFor(lines, entryDir);
  });
  if (missing.length === 0) return;

  const suffix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  await fs.promises.writeFile(
    gitignorePath,
    content + suffix + missing.map((e) => e + "\n").join(""),
    "utf-8",
  );
}

/**
 * Ensures `.dyad/` is listed in the project's `.gitignore`.
 * Creates `.gitignore` if it doesn't exist.
 */
export async function ensureDyadGitignored(appPath: string): Promise<void> {
  await ensureGitignored(appPath, [".dyad/"]);
}
