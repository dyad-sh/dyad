import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  let diff: string;
  let files: string[];

  if (params.baseCommit && params.targetCommit) {
    [diff, files] = await Promise.all([
      git(params.appPath, [
        "diff",
        "--no-ext-diff",
        "--no-color",
        params.baseCommit,
        params.targetCommit,
        "--",
      ]),
      git(params.appPath, [
        "diff",
        "--name-only",
        params.baseCommit,
        params.targetCommit,
        "--",
      ]).then(lines),
    ]);
  } else {
    const head = await git(params.appPath, ["rev-parse", "HEAD"]);
    const [trackedDiff, trackedFiles, untracked] = await Promise.all([
      git(params.appPath, [
        "diff",
        "--no-ext-diff",
        "--no-color",
        "HEAD",
        "--",
      ]),
      git(params.appPath, ["diff", "--name-only", "HEAD", "--"]).then(lines),
      git(params.appPath, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]).then((value) => value.split("\0").filter(Boolean)),
    ]);
    const untrackedDiffs: string[] = [];
    for (const file of untracked) {
      const buffer = await fs.readFile(`${params.appPath}/${file}`);
      if (buffer.includes(0)) {
        exclusions.push(`${file} (binary)`);
        continue;
      }
      untrackedDiffs.push(
        `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${buffer.toString("utf8").split("\n").length} @@\n${buffer
          .toString("utf8")
          .split("\n")
          .map((line) => `+${line}`)
          .join("\n")}`,
      );
    }
    diff = [trackedDiff, ...untrackedDiffs].filter(Boolean).join("\n");
    files = [...new Set([...trackedFiles, ...untracked])];
    params.baseCommit = head.trim();
  }

  return {
    baseCommit: params.baseCommit?.trim() || null,
    targetCommit: params.targetCommit?.trim() || null,
    diff,
    files,
    exclusions,
    hash: crypto.createHash("sha256").update(diff).digest("hex"),
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
