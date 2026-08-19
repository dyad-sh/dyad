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

import { gitListFilesNative, gitLog } from "@/ipc/utils/git_utils";
import {
  classifyGitOperationError,
  ensureGitLineEndingPolicy,
  GitConflictError,
  GIT_ERROR_CODES,
  gitStageToRevert,
  getGitUncommittedFiles,
  getGitUncommittedFilesWithStatus,
  countChangedLines,
  unquoteGitPath,
  isGitPathClean,
  inspectRepositoryHealth,
  readGitIndexEntries,
  restoreGitIndexEntries,
  gitAddAll,
  gitCommit,
  getGitStateFingerprint,
} from "@/ipc/utils/git_utils";

const execFileAsync = promisify(execFile);

describe("coded git errors", () => {
  it.each([
    [
      "Updates were rejected (non-fast-forward)",
      [GIT_ERROR_CODES.NON_FAST_FORWARD],
      GIT_ERROR_CODES.NON_FAST_FORWARD,
    ],
    [
      "Need to specify how to reconcile divergent branches",
      [GIT_ERROR_CODES.DIVERGENT_BRANCHES],
      GIT_ERROR_CODES.DIVERGENT_BRANCHES,
    ],
    [
      "Your local changes would be overwritten by checkout",
      [GIT_ERROR_CODES.UNCOMMITTED_CHANGES],
      GIT_ERROR_CODES.UNCOMMITTED_CHANGES,
    ],
  ] as const)("classifies %s", (message, expectedCodes, expectedCode) => {
    expect(
      classifyGitOperationError(new Error(message), expectedCodes),
    ).toMatchObject({ name: "GitStateError", code: expectedCode });
  });

  it("codes merge conflicts while retaining the compatibility name", () => {
    expect(GitConflictError("Merge conflict detected")).toMatchObject({
      name: "GitConflictError",
      code: GIT_ERROR_CODES.MERGE_CONFLICT,
    });
  });
});

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

describe("gitCommit", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      repoDir = undefined;
    }
  });

  it("can create an internal checkpoint while bypassing a failing pre-commit hook", async () => {
    repoDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "git-no-verify-"),
    );
    await runGit(repoDir, ["init"]);
    const hookPath = path.join(repoDir, ".git", "hooks", "pre-commit");
    await fs.promises.writeFile(hookPath, "#!/bin/sh\nexit 1\n");
    if (process.platform !== "win32") {
      await fs.promises.chmod(hookPath, 0o755);
    }
    await fs.promises.writeFile(path.join(repoDir, "file.txt"), "content\n");
    await gitAddAll({ path: repoDir });

    const commitHash = await gitCommit({
      path: repoDir,
      message: "internal checkpoint",
      noVerify: true,
    });

    expect(commitHash).toMatch(/^[0-9a-f]{40,64}$/);
  });

  it("runs pre-commit hooks by default for explicit user commits", async () => {
    repoDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "git-verify-default-"),
    );
    await runGit(repoDir, ["init"]);
    const hookPath = path.join(repoDir, ".git", "hooks", "pre-commit");
    await fs.promises.writeFile(hookPath, "#!/bin/sh\nexit 1\n");
    if (process.platform !== "win32") {
      await fs.promises.chmod(hookPath, 0o755);
    }
    await fs.promises.writeFile(path.join(repoDir, "file.txt"), "content\n");
    await gitAddAll({ path: repoDir });

    await expect(
      gitCommit({ path: repoDir, message: "explicit user commit" }),
    ).rejects.toThrow();
  });
});

describe("getGitStateFingerprint", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  it("changes when an existing untracked file's contents change", async () => {
    repoDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "git-fingerprint-untracked-"),
    );
    await runGit(repoDir, ["init"]);
    const filePath = path.join(repoDir, "untracked.txt");
    await fs.promises.writeFile(filePath, "before\n");
    const before = await getGitStateFingerprint(repoDir);

    await fs.promises.writeFile(filePath, "after!\n");

    await expect(getGitStateFingerprint(repoDir)).resolves.not.toBe(before);
  });

  it.runIf(process.platform !== "win32")(
    "hashes non-UTF-8 Git path bytes without replacement",
    async () => {
      repoDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "git-fingerprint-bytes-"),
      );
      await runGit(repoDir, ["init"]);
      const repoPrefix = Buffer.from(`${repoDir}${path.sep}`);
      const firstPath = Buffer.concat([
        repoPrefix,
        Buffer.from([0x66, 0x80, 0x2e, 0x74, 0x78, 0x74]),
      ]);
      const secondPath = Buffer.concat([
        repoPrefix,
        Buffer.from([0x66, 0x81, 0x2e, 0x74, 0x78, 0x74]),
      ]);
      await fs.promises.writeFile(firstPath, "same\n");
      const before = await getGitStateFingerprint(repoDir);

      await fs.promises.rename(firstPath, secondPath);

      await expect(getGitStateFingerprint(repoDir)).resolves.not.toBe(before);
    },
  );
});

describe("gitLog", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  it("disambiguates a branch ref that also names a project path", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-log-ref-"));
    await runGit(repoDir, ["init", "-b", "main"]);
    await fs.promises.mkdir(path.join(repoDir, "src"));
    await fs.promises.writeFile(
      path.join(repoDir, "src", "file.txt"),
      "main\n",
    );
    await commitAll(repoDir, "main commit");
    await runGit(repoDir, ["checkout", "-b", "src"]);
    await fs.promises.writeFile(
      path.join(repoDir, "src", "file.txt"),
      "branch\n",
    );
    await commitAll(repoDir, "branch commit");
    await runGit(repoDir, ["checkout", "main"]);

    const commits = await gitLog({ path: repoDir, ref: "src" });

    expect(commits[0].commit.message).toContain("branch commit");
  });
});

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

describe("inspectRepositoryHealth", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  it("ignores Dyad-managed working-tree churn when assessing cleanliness", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-health-"));
    await runGit(repoDir, ["init", "-b", "main"]);
    await fs.promises.writeFile(
      path.join(repoDir, "pnpm-workspace.yaml"),
      "packages: []\n",
    );
    await commitAll(repoDir, "initial");
    await fs.promises.writeFile(
      path.join(repoDir, "pnpm-workspace.yaml"),
      "packages:\n  - app\n",
    );

    await expect(
      inspectRepositoryHealth({ path: repoDir }),
    ).resolves.toMatchObject({
      branch: "main",
      isClean: true,
      operationInProgress: null,
    });

    await runGit(repoDir, ["config", "status.showUntrackedFiles", "no"]);
    await runGit(repoDir, ["update-ref", "REBASE_HEAD", "HEAD"]);
    await fs.promises.writeFile(path.join(repoDir, "visible.txt"), "dirty\n");
    await expect(
      inspectRepositoryHealth({ path: repoDir }),
    ).resolves.toMatchObject({
      branch: "main",
      isClean: false,
      operationInProgress: null,
    });
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

// Gates whether Dyad may auto-commit a file it rewrote: `git commit -- <path>`
// records the whole working-tree version of that path, so a file the user was
// already editing must not be committed on their behalf.
describe("isGitPathClean", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  async function makeRepo(): Promise<string> {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-clean-"));
    await runGit(repoDir, ["init"]);
    await runGit(repoDir, ["config", "user.email", "test@dyad.sh"]);
    await runGit(repoDir, ["config", "user.name", "Test"]);
    await fs.promises.writeFile(path.join(repoDir, "tracked.ts"), "one\n");
    await fs.promises.writeFile(path.join(repoDir, "other.ts"), "other\n");
    await runGit(repoDir, ["add", "."]);
    await runGit(repoDir, ["commit", "-m", "init"]);
    return repoDir;
  }

  it("is clean for a committed file with no local changes", async () => {
    const repo = await makeRepo();

    await expect(
      isGitPathClean({ path: repo, filepath: "tracked.ts" }),
    ).resolves.toBe(true);
  });

  it("is dirty for an unstaged edit", async () => {
    const repo = await makeRepo();
    await fs.promises.writeFile(path.join(repo, "tracked.ts"), "edited\n");

    await expect(
      isGitPathClean({ path: repo, filepath: "tracked.ts" }),
    ).resolves.toBe(false);
  });

  it("is dirty for a staged edit", async () => {
    const repo = await makeRepo();
    await fs.promises.writeFile(path.join(repo, "tracked.ts"), "staged\n");
    await runGit(repo, ["add", "tracked.ts"]);

    await expect(
      isGitPathClean({ path: repo, filepath: "tracked.ts" }),
    ).resolves.toBe(false);
  });

  it("is dirty for an untracked file", async () => {
    const repo = await makeRepo();
    await fs.promises.writeFile(path.join(repo, "new.ts"), "new\n");

    await expect(
      isGitPathClean({ path: repo, filepath: "new.ts" }),
    ).resolves.toBe(false);
  });

  // "Clean" authorizes an auto-commit, so a user config that merely HIDES
  // untracked files must not make a wholly untracked file look committed —
  // that would sweep every line the user wrote into Dyad's commit.
  it("is dirty for an untracked file even with status.showUntrackedFiles=no", async () => {
    const repo = await makeRepo();
    await runGit(repo, ["config", "status.showUntrackedFiles", "no"]);
    await fs.promises.writeFile(path.join(repo, "new.ts"), "new\n");

    await expect(
      isGitPathClean({ path: repo, filepath: "new.ts" }),
    ).resolves.toBe(false);
  });

  // Scoped to the path asked about: unrelated work elsewhere in the app is
  // exactly what the pathspec commit already leaves alone.
  it("ignores changes to other files", async () => {
    const repo = await makeRepo();
    await fs.promises.writeFile(path.join(repo, "other.ts"), "changed\n");

    await expect(
      isGitPathClean({ path: repo, filepath: "tracked.ts" }),
    ).resolves.toBe(true);
  });

  it("throws outside a git repository, so callers can't read it as clean", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-clean-"));

    await expect(
      isGitPathClean({ path: repoDir, filepath: "tracked.ts" }),
    ).rejects.toThrow();
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
      path.join(repoDir, ".dyad", "foo [bar]"),
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

describe("unquoteGitPath", () => {
  it("decodes octal bytes and preserves literal astral code points", () => {
    expect(unquoteGitPath('"caf\\303\\251-😀.txt"')).toBe("café-😀.txt");
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
      path.join(repo.repoDir, ".dyad", "foo [bar]"),
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

  it("does not hard reset when the pre-reset checkpoint fails", async () => {
    const repo = await createTwoVersionRepo();
    const preRestoreHead = await runGitOutput(repo.repoDir, [
      "rev-parse",
      "HEAD",
    ]);

    await expect(
      gitStageToRevert({
        path: repo.repoDir,
        targetOid: repo.targetOid,
        onBeforeReset: ({ nextStep }) => {
          if (nextStep === "hard-reset") throw new Error("checkpoint failed");
        },
      }),
    ).rejects.toThrow("checkpoint failed");

    await expect(
      runGitOutput(repo.repoDir, ["rev-parse", "HEAD"]),
    ).resolves.toBe(preRestoreHead);
  });

  it("exposes the exact interruption boundary after hard reset", async () => {
    const repo = await createTwoVersionRepo();

    await expect(
      gitStageToRevert({
        path: repo.repoDir,
        targetOid: repo.targetOid,
        onBeforeReset: ({ nextStep }) => {
          if (nextStep === "soft-reset") {
            throw new Error("simulated process interruption");
          }
        },
      }),
    ).rejects.toThrow("simulated process interruption");

    await expect(
      runGitOutput(repo.repoDir, ["rev-parse", "HEAD"]),
    ).resolves.toBe(repo.targetOid);
  });

  it("reports both reset boundaries without changing successful restore behavior", async () => {
    const repo = await createTwoVersionRepo();
    const preRestoreHead = await runGitOutput(repo.repoDir, [
      "rev-parse",
      "HEAD",
    ]);
    const boundaries: string[] = [];

    await expect(
      gitStageToRevert({
        path: repo.repoDir,
        targetOid: repo.targetOid,
        onBeforeReset: ({ nextStep }) => boundaries.push(nextStep),
      }),
    ).resolves.toBe(true);

    expect(boundaries).toEqual(["hard-reset", "soft-reset"]);
    await expect(
      runGitOutput(repo.repoDir, ["rev-parse", "HEAD"]),
    ).resolves.toBe(preRestoreHead);
    await expect(
      runGitOutput(repo.repoDir, ["diff", "--cached", "--name-only"]),
    ).resolves.toBe("app.ts");
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

describe("index entry snapshot and restore", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  async function initRepo(): Promise<string> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-index-"));
    await runGit(dir, ["init", "-b", "main"]);
    return dir;
  }

  it("round-trips an ordinary staged entry", async () => {
    repoDir = await initRepo();
    await fs.promises.writeFile(path.join(repoDir, "a.txt"), "staged\n");
    await runGit(repoDir, ["add", "a.txt"]);
    const before = await readGitIndexEntries({
      path: repoDir,
      filepath: "a.txt",
    });
    expect(before).toHaveLength(1);
    expect(before[0].stage).toBe(0);

    // Something else stages over it, the way a generated file would.
    await fs.promises.writeFile(path.join(repoDir, "a.txt"), "generated\n");
    await runGit(repoDir, ["add", "a.txt"]);
    await restoreGitIndexEntries({
      path: repoDir,
      filepath: "a.txt",
      entries: before,
    });

    expect(
      await readGitIndexEntries({ path: repoDir, filepath: "a.txt" }),
    ).toEqual(before);
  });

  it("removes the entry when the snapshot was empty", async () => {
    repoDir = await initRepo();
    await fs.promises.writeFile(path.join(repoDir, "a.txt"), "seed\n");
    await commitAll(repoDir, "seed");
    await fs.promises.writeFile(path.join(repoDir, "new.txt"), "new\n");
    const before = await readGitIndexEntries({
      path: repoDir,
      filepath: "new.txt",
    });
    expect(before).toEqual([]);

    await runGit(repoDir, ["add", "new.txt"]);
    await restoreGitIndexEntries({
      path: repoDir,
      filepath: "new.txt",
      entries: before,
    });

    expect(
      await readGitIndexEntries({ path: repoDir, filepath: "new.txt" }),
    ).toEqual([]);
  });

  // A conflicted path has no stage-0 entry — it has stages 1, 2 and 3. Reducing
  // them to the first blob would hand the user back a resolved-looking file
  // they never resolved.
  it("round-trips every stage of a conflicted path", async () => {
    const workingDir = await initRepo();
    repoDir = workingDir;
    const conflictVersions = ["base", "ours", "theirs"] as const;
    const before = await Promise.all(
      conflictVersions.map(async (version, index) => {
        const blobPath = `${version}.txt`;
        await fs.promises.writeFile(
          path.join(workingDir, blobPath),
          `${version}\n`,
        );
        return {
          mode: "100644",
          oid: await runGitOutput(workingDir, ["hash-object", "-w", blobPath]),
          stage: index + 1,
        };
      }),
    );
    await fs.promises.writeFile(path.join(workingDir, "c.txt"), "conflicted\n");
    await restoreGitIndexEntries({
      path: repoDir,
      filepath: "c.txt",
      entries: before,
    });

    const snapshot = await readGitIndexEntries({
      path: repoDir,
      filepath: "c.txt",
    });
    expect(snapshot.map((entry) => entry.stage)).toEqual([1, 2, 3]);

    // Staging over the conflict is exactly what collapses it to stage 0.
    await runGit(repoDir, ["add", "c.txt"]);
    expect(
      (await readGitIndexEntries({ path: repoDir, filepath: "c.txt" })).map(
        (entry) => entry.stage,
      ),
    ).toEqual([0]);

    await restoreGitIndexEntries({
      path: repoDir,
      filepath: "c.txt",
      entries: snapshot,
    });

    expect(
      await readGitIndexEntries({ path: repoDir, filepath: "c.txt" }),
    ).toEqual(snapshot);
    // And git agrees the path is unmerged again.
    expect(
      await runGitOutput(repoDir, ["diff", "--name-only", "--diff-filter=U"]),
    ).toBe("c.txt");
  });
});
