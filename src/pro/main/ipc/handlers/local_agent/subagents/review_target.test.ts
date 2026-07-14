import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { buildReviewTarget, REVIEW_MAX_FILE_BYTES } from "./review_target";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("buildReviewTarget", () => {
  it("uses an assistant turn's immutable commit range", async () => {
    const repo = await makeRepo();
    await fs.writeFile(
      path.join(repo, "feature.ts"),
      "export const value = 1;\n",
    );
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "base");
    const base = await git(repo, "rev-parse", "HEAD");
    await fs.writeFile(
      path.join(repo, "feature.ts"),
      "export const value = 2;\n",
    );
    await git(repo, "commit", "-am", "change");
    const target = await git(repo, "rev-parse", "HEAD");

    const review = await buildReviewTarget({
      appPath: repo,
      baseCommit: base.trim(),
      targetCommit: target.trim(),
    });

    expect(review.files).toEqual(["feature.ts"]);
    expect(review.diff).toContain("+export const value = 2;");
    expect(review.baseCommit).toBe(base.trim());
    expect(review.targetCommit).toBe(target.trim());
  });

  it("falls back to tracked and non-ignored untracked working-tree text", async () => {
    const repo = await makeRepo();
    await fs.writeFile(path.join(repo, "tracked.ts"), "old\n");
    await fs.writeFile(path.join(repo, ".gitignore"), "ignored.txt\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "base");
    await fs.writeFile(path.join(repo, "tracked.ts"), "new\n");
    await fs.writeFile(path.join(repo, "new.ts"), "created\n");
    await fs.writeFile(path.join(repo, "ignored.txt"), "secret\n");

    const review = await buildReviewTarget({ appPath: repo });

    expect(review.files.sort()).toEqual(["new.ts", "tracked.ts"]);
    expect(review.diff).toContain("+created");
    expect(review.diff).not.toContain("secret");
  });

  it("reviews staged and untracked files in a repository without a commit", async () => {
    const repo = await makeRepo();
    await fs.writeFile(
      path.join(repo, "staged.ts"),
      "export const staged = true;\n",
    );
    await git(repo, "add", "staged.ts");
    await fs.writeFile(
      path.join(repo, "untracked.ts"),
      "export const untracked = true;\n",
    );

    const review = await buildReviewTarget({ appPath: repo });

    expect(review.baseCommit).toBeNull();
    expect(review.files.sort()).toEqual(["staged.ts", "untracked.ts"]);
    expect(review.diff).toContain("+export const staged = true;");
    expect(review.diff).toContain("+export const untracked = true;");
  });

  it("does not follow untracked symbolic links", async () => {
    const repo = await makeRepo();
    const outside = path.join(
      path.dirname(repo),
      `${path.basename(repo)}-secret`,
    );
    await fs.writeFile(outside, "host secret\n");
    await fs.symlink(outside, path.join(repo, "linked-secret.txt"));

    const review = await buildReviewTarget({ appPath: repo });

    expect(review.diff).not.toContain("host secret");
    expect(review.files).not.toContain("linked-secret.txt");
    expect(review.exclusions).toContain("linked-secret.txt (symbolic link)");
    await fs.rm(outside, { force: true });
  });

  it("excludes oversized untracked files without reading them into the diff", async () => {
    const repo = await makeRepo();
    await fs.writeFile(
      path.join(repo, "oversized.txt"),
      Buffer.alloc(REVIEW_MAX_FILE_BYTES + 1, "x"),
    );

    const review = await buildReviewTarget({ appPath: repo });

    expect(review.diff).toBe("");
    expect(review.files).not.toContain("oversized.txt");
    expect(review.exclusions).toContain(
      "oversized.txt (exceeds per-file review limit)",
    );
  });

  it("excludes oversized tracked diffs", async () => {
    const repo = await makeRepo();
    await fs.writeFile(path.join(repo, "large.txt"), "small\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "base");
    await fs.writeFile(
      path.join(repo, "large.txt"),
      Buffer.alloc(REVIEW_MAX_FILE_BYTES + 1, "x"),
    );

    const review = await buildReviewTarget({ appPath: repo });

    expect(review.diff).toBe("");
    expect(review.files).not.toContain("large.txt");
    expect(review.exclusions).toContain(
      "large.txt (diff exceeds per-file review limit)",
    );
  });
});

async function makeRepo(): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-review-target-"));
  tempDirs.push(repo);
  await git(repo, "init");
  await git(repo, "config", "user.email", "test@example.com");
  await git(repo, "config", "user.name", "Test");
  return repo;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}
