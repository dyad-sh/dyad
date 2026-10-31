import fs from "node:fs";
import path from "node:path";

// Example line:
// [2025-06-09 13:55:05.209] [debug] (runShellCommand) Command "which node" succeeded with code 0: /usr/local/bin/node
const LOG_LEVEL_PREFIX = /^\[[^\]]*\] \[(\w+)\]/;

/**
 * Selects the lines of an electron-log file at or above `level`.
 *
 * A multi-line entry has only one level prefix, so its untagged continuation
 * lines (stack traces, the rest of an inspected object) follow their entry:
 * kept with a warning, dropped with an info line.
 */
export function filterLogLines(
  logContent: string,
  level: "warn" | "info",
): string[] {
  const lines = logContent.split("\n");
  if (level === "info") {
    return lines;
  }

  let keepingEntry = false;
  return lines.filter((line) => {
    if (line.trim() === "") {
      return false;
    }
    const match = line.match(LOG_LEVEL_PREFIX);
    if (match) {
      keepingEntry = match[1] === "warn" || match[1] === "error";
    }
    return keepingEntry;
  });
}

function readIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/**
 * Reads the newest `limit` lines at or above `level`. Rotation can land at any
 * point in a session, so lines the current file can't supply come from the
 * archive electron-log renames it to (`main.log` -> `main.old.log`).
 */
export function readRecentLogLines(
  logPath: string,
  limit: number,
  level: "warn" | "info",
): string[] {
  const current = readIfExists(logPath);
  const currentLines = filterLogLines(current, level);
  if (currentLines.length >= limit) {
    return currentLines.slice(-limit);
  }

  const { dir, name, ext } = path.parse(logPath);
  let archive: string;
  try {
    archive = readIfExists(path.join(dir, `${name}.old${ext}`));
  } catch {
    return currentLines;
  }
  // Filtered as one text so an entry split by rotation keeps its continuation.
  return filterLogLines(archive + current, level).slice(-limit);
}
