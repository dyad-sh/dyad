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
    .map((p) => ({ p, mtime: mtimeMs(p) }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((x) => x.p);
}

function mtimeMs(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
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
