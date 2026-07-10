import fs from "node:fs";
import path from "node:path";

// Absolute paths of the minidump files in a directory, newest first.
export function listDumpFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const dumps = entries
    .filter((f) => f.endsWith(".dmp"))
    .map((f) => path.join(dir, f));
  return sortNewestFirst(dumps);
}

// Absolute paths of every .dmp anywhere under a directory tree, newest first.
// Crashpad's dump location is platform-specific (pending/ on Linux/macOS,
// reports/ on Windows), so we search the whole crashDumps tree rather than
// assume one subdirectory.
export function listDumpFilesRecursive(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".dmp")) found.push(p);
    }
  };
  walk(dir);
  return sortNewestFirst(found);
}

// Keep only the `max` newest pending dumps while scanning, deleting older
// dumps (and sidecars) as soon as they fall outside the bounded candidate set.
// This preserves the eventual prune behavior without first retaining every
// path in memory or parsing an unbounded backlog during startup.
export function pruneAndListNewestDumpFilesRecursive(
  dir: string,
  max: number,
): string[] {
  if (!Number.isSafeInteger(max) || max < 0) {
    throw new RangeError("max must be a non-negative safe integer");
  }

  const newest: Array<{ path: string; mtime: number }> = [];
  const directories = [dir];

  while (directories.length > 0) {
    const currentDir = directories.pop()!;
    let directory: fs.Dir | undefined;
    try {
      directory = fs.opendirSync(currentDir);
      let entry: fs.Dirent | null;
      while ((entry = directory.readSync()) !== null) {
        const entryPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          directories.push(entryPath);
        } else if (entry.name.endsWith(".dmp")) {
          const mtime = mtimeMs(entryPath);
          // Crashpad may still be rotating this report. If stat fails, leave the
          // dump untouched for a later launch rather than treating it as the
          // oldest entry and deleting a potentially fresh report.
          if (mtime === undefined) continue;

          const candidate = { path: entryPath, mtime };
          const insertAt = newest.findIndex(
            (existing) => candidate.mtime > existing.mtime,
          );
          if (insertAt === -1) newest.push(candidate);
          else newest.splice(insertAt, 0, candidate);

          if (newest.length > max) {
            deleteDump(newest.pop()!.path);
          }
        }
      }
    } catch {
      // Crashpad directories can disappear while it rotates reports.
    } finally {
      try {
        directory?.closeSync();
      } catch {
        // Best effort; startup crash reporting must never prevent app launch.
      }
    }
  }

  return newest.map((candidate) => candidate.path);
}

// Delete a dump and its Crashpad metadata sidecar (best effort).
export function deleteDump(dumpPath: string): void {
  unlinkQuiet(dumpPath);
  unlinkQuiet(dumpPath.replace(/\.dmp$/, ".meta"));
}

// Move a dump (and its .meta sidecar) to a new path (best effort).
export function moveDump(src: string, dest: string): void {
  renameQuiet(src, dest);
  renameQuiet(src.replace(/\.dmp$/, ".meta"), dest.replace(/\.dmp$/, ".meta"));
}

// Keep at most `max` most-recent dumps; delete the rest (and their sidecars).
export function pruneDumps(dir: string, max: number): void {
  for (const dump of listDumpFiles(dir).slice(max)) {
    deleteDump(dump);
  }
}

// Sort paths newest-first, reading each file's mtime once (not inside the
// comparator, which would re-stat on every comparison).
function sortNewestFirst(paths: string[]): string[] {
  return paths
    .map((p) => ({ p, mtime: mtimeMs(p) ?? 0 }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((x) => x.p);
}

function mtimeMs(p: string): number | undefined {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return undefined;
  }
}

function unlinkQuiet(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch {
    // Best effort — nothing actionable if the file is already gone.
  }
}

// Move a file, best effort. If the rename fails (cross-device, a locked file,
// etc.), preserve the file by copying it first when possible, then remove the
// source so it isn't read again on the next launch.
function renameQuiet(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
    return;
  } catch {
    try {
      fs.copyFileSync(src, dest);
    } catch {
      // source may be unreadable; still remove it below to avoid reprocessing
    }
  }
  unlinkQuiet(src);
}
