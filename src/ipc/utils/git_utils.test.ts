import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

import { gitListFilesNative } from "@/ipc/utils/git_utils";
import {
  ensureGitLineEndingPolicy,
  gitStageToRevert,
  getGitUncommittedFiles,
  getGitUncommittedFilesWithStatus,
  countChangedLines,
} from "@/ipc/utils/git_utils";

const execFileAsync = promisify(execFile);

async function commitAll(repoDir: string, message: string): Promise<void> {
  await runGit(repoDir, ["add", "-A"]);
  await runGit(repoDir, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test User",
    "commit",
    "-m",
    message,
  ]);
}

async function runGit(repoDir: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repoDir });
}

async function runGitOutput(repoDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoDir });
  return stdout.trim();
}

describe("ensureGitLineEndingPolicy", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  it("sets repo-local native git line ending config and creates gitattributes", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));

    await runGit(repoDir, ["init"]);

    await ensureGitLineEndingPolicy({
      path: repoDir,
      writeGitattributes: true,
    });

    await expect(
      fs.promises.readFile(path.join(repoDir, ".gitattributes"), "utf8"),
    ).resolves.toContain("* text=auto eol=lf");
    await expect(
      runGitOutput(repoDir, ["config", "--local", "core.autocrlf"]),
    ).resolves.toBe("false");
    await expect(
      runGitOutput(repoDir, ["config", "--local", "core.eol"]),
    ).resolves.toBe("lf");
    await expect(
      runGitOutput(repoDir, ["config", "--local", "core.safecrlf"]),
    ).resolves.toBe("warn");
  });

  it("does not overwrite an existing gitattributes file", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));
    await runGit(repoDir, ["init"]);
    await fs.promises.writeFile(
      path.join(repoDir, ".gitattributes"),
      "*.png binary\n",
    );

    await ensureGitLineEndingPolicy({
      path: repoDir,
      writeGitattributes: true,
    });

    await expect(
      fs.promises.readFile(path.join(repoDir, ".gitattributes"), "utf8"),
    ).resolves.toBe("*.png binary\n");
  });

  it("does not create gitattributes for non-repo paths", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));

    await ensureGitLineEndingPolicy({
      path: repoDir,
      writeGitattributes: true,
    });

    await expect(
      fs.promises.stat(path.join(repoDir, ".gitattributes")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("caches native git line ending config per repo path", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));

    await runGit(repoDir, ["init"]);
    await ensureGitLineEndingPolicy({ path: repoDir });
    await runGit(repoDir, ["config", "--local", "core.eol", "crlf"]);

    await ensureGitLineEndingPolicy({ path: repoDir });

    await expect(
      runGitOutput(repoDir, ["config", "--local", "core.eol"]),
    ).resolves.toBe("crlf");
  });
});

describe("gitListFilesNative", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  it("excludes files inside skipped directories recursively", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));

    await runGit(repoDir, ["init"]);

    await fs.promises.mkdir(path.join(repoDir, "src"), { recursive: true });
    await fs.promises.mkdir(path.join(repoDir, "dist"), { recursive: true });
    await fs.promises.mkdir(path.join(repoDir, "build"), { recursive: true });
    await fs.promises.mkdir(path.join(repoDir, "packages", "app", "dist"), {
      recursive: true,
    });
    await fs.promises.mkdir(path.join(repoDir, "node_modules", "pkg"), {
      recursive: true,
    });

    await fs.promises.writeFile(path.join(repoDir, "src", "index.ts"), "src");
    await fs.promises.writeFile(
      path.join(repoDir, "dist", "tracked.js"),
      "tracked dist output",
    );
    await fs.promises.writeFile(
      path.join(repoDir, "build", "tracked.js"),
      "tracked build output",
    );
    await fs.promises.writeFile(
      path.join(repoDir, "packages", "app", "dist", "nested.js"),
      "nested dist output",
    );
    await fs.promises.writeFile(
      path.join(repoDir, "node_modules", "pkg", "index.js"),
      "dependency output",
    );
    await fs.promises.writeFile(
      path.join(repoDir, "package-lock.json"),
      '{"lockfileVersion":3}',
    );

    await runGit(repoDir, [
      "add",
      "src/index.ts",
      "dist/tracked.js",
      "build/tracked.js",
    ]);

    const files = await gitListFilesNative({
      path: repoDir,
      excludedDirs: ["node_modules", "dist", "build"],
      excludedFiles: ["package-lock.json"],
    });

    expect(files).toEqual(["src/index.ts"]);
  });
});

describe("getGitUncommittedFiles", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  it("ignores Dyad-managed runtime files in native git status", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));

    await runGit(repoDir, ["init"]);
    await fs.promises.mkdir(path.join(repoDir, ".dyad"), { recursive: true });
    await fs.promises.writeFile(
      path.join(repoDir, "pnpm-workspace.yaml"),
      'packages: ["."]\n',
    );
    await fs.promises.writeFile(
      path.join(repoDir, ".dyad", "screenshot.png"),
      "generated",
    );
    await fs.promises.writeFile(path.join(repoDir, "src.ts"), "user change");

    await expect(getGitUncommittedFiles({ path: repoDir })).resolves.toEqual([
      "src.ts",
    ]);
  });

  it("ignores Dyad-managed runtime files in native status details", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));

    await runGit(repoDir, ["init"]);
    await fs.promises.mkdir(path.join(repoDir, ".dyad"), { recursive: true });
    await fs.promises.writeFile(
      path.join(repoDir, "pnpm-workspace.yaml"),
      'packages: ["."]\n',
    );
    await fs.promises.writeFile(
      path.join(repoDir, ".dyad", "screenshot.png"),
      "generated",
    );
    await fs.promises.writeFile(
      path.join(repoDir, ".dyad", "foo -> bar"),
      "generated",
    );
    await fs.promises.writeFile(path.join(repoDir, "src.ts"), "user change");

    await expect(
      getGitUncommittedFilesWithStatus({ path: repoDir }),
    ).resolves.toEqual([
      { path: "src.ts", status: "added", additions: 1, deletions: 0 },
    ]);
  });

  it("reports added/deleted line counts for a modified file", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));

    await runGit(repoDir, ["init"]);
    await runGit(repoDir, ["config", "user.email", "test@example.com"]);
    await runGit(repoDir, ["config", "user.name", "Test"]);
    await fs.promises.writeFile(path.join(repoDir, "src.ts"), "a\nb\nc\n");
    await runGit(repoDir, ["add", "."]);
    await runGit(repoDir, ["commit", "-m", "init"]);

    // Keep line "a", change "b" -> "B", drop "c", add "d": +2 / -2 vs HEAD.
    await fs.promises.writeFile(path.join(repoDir, "src.ts"), "a\nB\nd\n");

    await expect(
      getGitUncommittedFilesWithStatus({ path: repoDir }),
    ).resolves.toEqual([
      { path: "src.ts", status: "modified", additions: 2, deletions: 2 },
    ]);
  });

  it("decodes git's octal-escaped non-ASCII paths in native git status", async () => {
    const nextRepoDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "git-utils-"),
    );
    repoDir = nextRepoDir;

    await runGit(nextRepoDir, ["init"]);
    await fs.promises.mkdir(path.join(nextRepoDir, ".dyad"), {
      recursive: true,
    });
    // Git quotes these non-ASCII names with `\NNN` octal escapes in porcelain
    // output; both must be decoded back to their real UTF-8 paths so the
    // user-visible file is reported and the `.dyad/` one is still filtered out.
    await fs.promises.writeFile(
      path.join(nextRepoDir, "café.txt"),
      "user change",
    );
    await fs.promises.writeFile(
      path.join(nextRepoDir, "emoji-😀.txt"),
      "user change",
    );
    await fs.promises.writeFile(
      path.join(nextRepoDir, ".dyad", "naïve.png"),
      "generated",
    );

    await expect(
      getGitUncommittedFiles({ path: nextRepoDir }),
    ).resolves.toEqual(["café.txt", "emoji-😀.txt"]);
  });
});

describe("countChangedLines", () => {
  it("counts additions and deletions like git numstat", () => {
    expect(countChangedLines("a\nb\nc\n", "a\nB\nd\n")).toEqual({
      additions: 2,
      deletions: 2,
    });
  });

  it("counts a new file as all additions", () => {
    expect(countChangedLines("", "x\ny\n")).toEqual({
      additions: 2,
      deletions: 0,
    });
  });

  it("counts a cleared file as all deletions", () => {
    expect(countChangedLines("x\ny\nz\n", "")).toEqual({
      additions: 0,
      deletions: 3,
    });
  });

  it("returns zero for identical content", () => {
    expect(countChangedLines("same\n", "same\n")).toEqual({
      additions: 0,
      deletions: 0,
    });
  });
});

describe("gitStageToRevert", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  async function createTwoVersionRepo() {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));
    await runGit(repoDir, ["init"]);
    await fs.promises.writeFile(path.join(repoDir, "app.ts"), "version 1\n");
    await commitAll(repoDir, "version 1");
    const targetOid = await runGitOutput(repoDir, ["rev-parse", "HEAD"]);
    await fs.promises.writeFile(path.join(repoDir, "app.ts"), "version 2\n");
    await commitAll(repoDir, "version 2");
    return { repoDir, targetOid };
  }

  it("ignores untracked Dyad-managed runtime files", async () => {
    const repo = await createTwoVersionRepo();
    await fs.promises.mkdir(path.join(repo.repoDir, ".dyad"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(repo.repoDir, ".dyad", "screenshot.png"),
      "generated",
    );
    await fs.promises.writeFile(
      path.join(repo.repoDir, ".dyad", "foo -> bar"),
      "generated",
    );
    await fs.promises.writeFile(
      path.join(repo.repoDir, "pnpm-workspace.yaml"),
      'packages: ["."]\n',
    );

    await expect(
      gitStageToRevert({ path: repo.repoDir, targetOid: repo.targetOid }),
    ).resolves.toBe(true);
  });

  it("still rejects user-visible uncommitted files", async () => {
    const repo = await createTwoVersionRepo();
    await fs.promises.writeFile(
      path.join(repo.repoDir, "manual-notes.txt"),
      "unfinished work",
    );

    await expect(
      gitStageToRevert({ path: repo.repoDir, targetOid: repo.targetOid }),
    ).rejects.toMatchObject({
      message: "Cannot revert: working tree has uncommitted changes.",
    });
  });

  it("treats current-HEAD restores with only managed runtime files as no-ops", async () => {
    const repo = await createTwoVersionRepo();
    const currentOid = await runGitOutput(repo.repoDir, ["rev-parse", "HEAD"]);
    await fs.promises.writeFile(
      path.join(repo.repoDir, "pnpm-workspace.yaml"),
      'packages: ["."]\n',
    );

    await expect(
      gitStageToRevert({ path: repo.repoDir, targetOid: currentOid }),
    ).resolves.toBe(false);
  });

  it("rejects current-HEAD restores with staged user-visible files", async () => {
    const repo = await createTwoVersionRepo();
    const currentOid = await runGitOutput(repo.repoDir, ["rev-parse", "HEAD"]);
    await fs.promises.writeFile(
      path.join(repo.repoDir, "manual-notes.txt"),
      "unfinished work",
    );
    await runGit(repo.repoDir, ["add", "manual-notes.txt"]);

    await expect(
      gitStageToRevert({ path: repo.repoDir, targetOid: currentOid }),
    ).rejects.toMatchObject({
      message: "Cannot revert: working tree has uncommitted changes.",
    });
  });

});
