import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertPathNotGitMetadata } from "./path_utils";

describe("assertPathNotGitMetadata", () => {
  let appPath: string;

  beforeEach(() => {
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-path-guard-"));
    fs.mkdirSync(path.join(appPath, ".git"));
    fs.writeFileSync(path.join(appPath, ".git", "config"), "original");
  });

  afterEach(() => {
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  it.each([
    ".git",
    ".git/config",
    ".GIT/config",
    "nested/.git/hooks/post-commit",
    ".git\\config",
    ".git./config",
    ".git /config",
    "nested/.GiT... /config",
    "src/../.git/config",
  ])("rejects Git metadata path %s", async (relativePath) => {
    await expect(
      assertPathNotGitMetadata({ appPath, relativePath }),
    ).rejects.toThrow("cannot modify Git metadata");
  });

  it.each([
    ".gitignore",
    ".github/workflows/ci.yml",
    "src/.gitkeep",
    "foo.git",
  ])("allows ordinary path %s", async (relativePath) => {
    await expect(
      assertPathNotGitMetadata({ appPath, relativePath }),
    ).resolves.toBeUndefined();
  });

  it.runIf(process.platform !== "win32")(
    "rejects existing and missing targets through a Git metadata symlink",
    async () => {
      fs.symlinkSync(".git", path.join(appPath, "gitmeta"), "dir");

      await expect(
        assertPathNotGitMetadata({
          appPath,
          relativePath: "gitmeta/config",
        }),
      ).rejects.toThrow("cannot modify Git metadata");
      await expect(
        assertPathNotGitMetadata({
          appPath,
          relativePath: "gitmeta/new/deep/config",
        }),
      ).rejects.toThrow("cannot modify Git metadata");
    },
  );

  it.runIf(process.platform !== "win32")(
    "fails closed for a dangling symlink ancestor",
    async () => {
      fs.symlinkSync(".git/missing", path.join(appPath, "dangling"), "dir");

      await expect(
        assertPathNotGitMetadata({
          appPath,
          relativePath: "dangling/config",
        }),
      ).rejects.toThrow("cannot modify through an unresolved symlink");
    },
  );

  it("rejects linked-worktree gitdir and common metadata paths", async () => {
    fs.rmSync(path.join(appPath, ".git"), { recursive: true, force: true });
    const commonDirectory = path.join(appPath, "linked-metadata");
    const worktreeGitDirectory = path.join(commonDirectory, "worktrees", "app");
    fs.mkdirSync(worktreeGitDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(appPath, ".git"),
      "gitdir: linked-metadata/worktrees/app\n",
    );
    fs.writeFileSync(path.join(worktreeGitDirectory, "commondir"), "../..\n");

    await expect(
      assertPathNotGitMetadata({
        appPath,
        relativePath: "linked-metadata/worktrees/app/index",
      }),
    ).rejects.toThrow("cannot modify Git metadata");
    await expect(
      assertPathNotGitMetadata({
        appPath,
        relativePath: "linked-metadata/hooks/post-commit",
      }),
    ).rejects.toThrow("cannot modify Git metadata");
  });
});
