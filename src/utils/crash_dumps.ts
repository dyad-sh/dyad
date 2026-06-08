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
  return entries
    .filter((f) => f.endsWith(".dmp"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => mtimeMs(b) - mtimeMs(a));
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
  return found.sort((a, b) => mtimeMs(b) - mtimeMs(a));
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

function renameQuiet(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch {
    // Best effort — sidecar may not exist, or the source is already gone.
  }
}
