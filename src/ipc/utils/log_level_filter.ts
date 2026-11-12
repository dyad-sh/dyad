import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

const logger = log.scope("log_level_filter");

// Example line:
// [2025-06-09 13:55:05.209] [debug] (runShellCommand) Command "which node" succeeded with code 0: /usr/local/bin/node
const LOG_LEVEL_PREFIX =
  /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[(\w+)\]/;

/**
 * Selects lines from an electron-log file. `warn` keeps warnings and errors;
 * `info` keeps every line, unfiltered.
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
 * Reads the newest `limit` lines selected by `filterLogLines`. Rotation can land
 * at any point in a session, so lines the current file can't supply come from
 * the archive electron-log renames it to (`main.log` -> `main.old.log`).
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
  } catch (err) {
    logger.warn("Could not read the rotated log file:", err);
    return currentLines;
  }
  // Filtered as one text so an entry split by rotation keeps its continuation.
  return filterLogLines(archive + current, level).slice(-limit);
}
