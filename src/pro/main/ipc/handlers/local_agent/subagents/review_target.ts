import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const REVIEW_MAX_FILE_BYTES = 512 * 1024;
export const REVIEW_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface ReviewTarget {
  baseCommit: string | null;
  targetCommit: string | null;
  diff: string;
  files: string[];
  exclusions: string[];
  hash: string;
}

export async function buildReviewTarget(params: {
  appPath: string;
  baseCommit?: string | null;
  targetCommit?: string | null;
}): Promise<ReviewTarget> {
  await git(params.appPath, ["rev-parse", "--git-dir"]);
  const exclusions: string[] = [];
  const chunks: string[] = [];
  const includedFiles = new Set<string>();
  let includedBytes = 0;
  let effectiveBaseCommit = params.baseCommit?.trim() || null;

  const addDiff = (file: string, value: string): void => {
    const bytes = Buffer.byteLength(value);
    if (bytes > REVIEW_MAX_FILE_BYTES) {
      exclusions.push(`${file} (diff exceeds per-file review limit)`);
      return;
    }
    if (includedBytes + bytes > REVIEW_MAX_TOTAL_BYTES) {
      exclusions.push(`${file} (aggregate review limit reached)`);
      return;
    }
    chunks.push(value);
    includedFiles.add(file);
    includedBytes += bytes;
  };

  if (params.baseCommit && params.targetCommit) {
    const files = await git(params.appPath, [
      "diff",
      "--name-only",
      "-z",
      params.baseCommit,
      params.targetCommit,
      "--",
    ]).then(nulSeparated);
    for (const file of files) {
      const value = await boundedGitDiff(params.appPath, [
        params.baseCommit,
        params.targetCommit,
        "--",
        file,
      ]);
      if (value === null) {
        exclusions.push(`${file} (diff exceeds per-file review limit)`);
      } else {
        addDiff(file, value);
      }
    }
  } else {
    const head = await tryGit(params.appPath, [
      "rev-parse",
      "--verify",
      "HEAD",
    ]);
    const comparisonBase = head?.trim() || EMPTY_TREE;
    const [trackedFiles, untracked] = await Promise.all([
      git(params.appPath, [
        "diff",
        "--name-only",
        "-z",
        comparisonBase,
        "--",
      ]).then(nulSeparated),
      git(params.appPath, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]).then((value) => value.split("\0").filter(Boolean)),
    ]);

    for (const file of trackedFiles) {
      const value = await boundedGitDiff(params.appPath, [
        comparisonBase,
        "--",
        file,
      ]);
      if (value === null) {
        exclusions.push(`${file} (diff exceeds per-file review limit)`);
      } else {
        addDiff(file, value);
      }
    }

    const appRoot = await fs.realpath(params.appPath);
    for (const file of untracked) {
      const absolutePath = path.resolve(params.appPath, file);
      let stat;
      try {
        stat = await fs.lstat(absolutePath);
      } catch {
        exclusions.push(`${file} (unreadable)`);
        continue;
      }
      if (stat.isSymbolicLink()) {
        exclusions.push(`${file} (symbolic link)`);
        continue;
      }
      if (!stat.isFile()) {
        exclusions.push(`${file} (not a regular file)`);
        continue;
      }
      let realPath: string;
      try {
        realPath = await fs.realpath(absolutePath);
      } catch {
        exclusions.push(`${file} (unreadable)`);
        continue;
      }
      if (!isInside(appRoot, realPath)) {
        exclusions.push(`${file} (outside app root)`);
        continue;
      }
      if (stat.size > REVIEW_MAX_FILE_BYTES) {
        exclusions.push(`${file} (exceeds per-file review limit)`);
        continue;
      }

      const handle = await fs.open(realPath, "r");
      let buffer: Buffer;
      try {
        buffer = Buffer.alloc(
          Math.min(stat.size + 1, REVIEW_MAX_FILE_BYTES + 1),
        );
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        buffer = buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
      if (buffer.length > REVIEW_MAX_FILE_BYTES) {
        exclusions.push(`${file} (exceeds per-file review limit)`);
        continue;
      }
      if (buffer.includes(0)) {
        exclusions.push(`${file} (binary)`);
        continue;
      }

      const text = buffer.toString("utf8");
      const textLines = text.split("\n");
      const syntheticDiff = `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${textLines.length} @@\n${textLines.map((line) => `+${line}`).join("\n")}`;
      addDiff(file, syntheticDiff);
    }
    effectiveBaseCommit = head?.trim() || null;
  }

  const diff = chunks.filter(Boolean).join("\n");
  return {
    baseCommit: effectiveBaseCommit,
    targetCommit: params.targetCommit?.trim() || null,
    diff,
    files: [...includedFiles],
    exclusions,
    hash: crypto.createHash("sha256").update(diff).digest("hex"),
  };
}

async function boundedGitDiff(
  cwd: string,
  rangeAndPath: string[],
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--no-ext-diff", "--no-color", ...rangeAndPath],
      { cwd, maxBuffer: REVIEW_MAX_FILE_BYTES + 64 * 1024 },
    );
    return Buffer.byteLength(stdout) <= REVIEW_MAX_FILE_BYTES ? stdout : null;
  } catch (error) {
    if (
      error instanceof RangeError ||
      (error instanceof Error && error.message.includes("maxBuffer"))
    ) {
      return null;
    }
    throw error;
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function nulSeparated(value: string): string[] {
  return value.split("\0").filter(Boolean);
}
