import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import {
  gitListBranches,
  inspectRepositoryHealth,
  isGitMergeInProgress,
  isGitMergeOrRebaseInProgress,
} from "./git_utils";
import {
  isDyadMetadataExcludedSync,
  resolveGitCommonDirSync,
  resolveGitDirSync,
} from "./git_dir";
import {
  addBranchWorktree,
  checkoutBranchWorktree,
  commitInProgressMerge,
  createSquashCommit,
  deleteMergedBranch,
  forceDeleteBranch,
  getCommitSubject,
  haveSameTree,
  recordMergedCommit,
  diffPathsByStatus,
  excludeDyadMetadata,
  fastForwardCheckedOutBranch,
  findFilesWithConflictMarkers,
  gitBranchExists,
  isAncestorCommit,
  isMergeInProgress,
  isWorktreeLinkBroken,
  listBranchesContaining,
  listCommitsNotIn,
  listGitWorktrees,
  listUncommittedPaths,
  mergeIntoWorkspace,
  removeLinkedWorktree,
  repairLinkedWorktrees,
  revertCommitsAsOne,
  stageAllChanges,
  restoreMissingTrackedFiles,
} from "./git_worktree_utils";

const execFileAsync = promisify(execFile);
const IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...IDENTITY, ...args], {
    cwd,
  });
  return stdout.trim();
}

async function commitFile(
  cwd: string,
  file: string,
  content: string,
  message: string,
): Promise<string> {
  await fs.promises.mkdir(path.dirname(path.join(cwd, file)), {
    recursive: true,
  });
  await fs.promises.writeFile(path.join(cwd, file), content);
  await git(cwd, ["add", "-A"]);
  await git(cwd, ["commit", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

describe("git worktree helpers", () => {
  let root: string;
  let repo: string;
  let worktree: string;

  beforeEach(async () => {
    root = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "dyad-worktree-")),
    );
    repo = path.join(root, "app");
    worktree = path.join(root, "workspaces", "chat-1");
    await fs.promises.mkdir(repo);
    await git(repo, ["init", "-b", "main"]);
    await commitFile(repo, "src/App.tsx", "line 1\nline 2\nline 3\n", "init");
  });

  afterEach(async () => {
    await fs.promises.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });

  async function createWorkspace() {
    const base = await git(repo, ["rev-parse", "main"]);
    await addBranchWorktree({
      repositoryPath: repo,
      worktreePath: worktree,
      branch: "dyad/chat-1",
      startPoint: base,
    });
    return base;
  }

  it("creates a branch worktree from committed state only", async () => {
    await fs.promises.writeFile(path.join(repo, "uncommitted.txt"), "draft");
    await createWorkspace();
    expect(fs.existsSync(path.join(worktree, "src/App.tsx"))).toBe(true);
    // Another checkout's uncommitted edits never follow into a new workspace.
    expect(fs.existsSync(path.join(worktree, "uncommitted.txt"))).toBe(false);
    expect(fs.statSync(path.join(worktree, ".git")).isFile()).toBe(true);
    expect(await git(worktree, ["branch", "--show-current"])).toBe(
      "dyad/chat-1",
    );
    const worktrees = await listGitWorktrees(repo);
    expect(worktrees.map((entry) => entry.branch)).toEqual([
      "main",
      "dyad/chat-1",
    ]);
    expect(await gitBranchExists({ path: repo, branch: "dyad/chat-1" })).toBe(
      true,
    );
  });

  it("resolves a linked worktree's own and shared Git directories", async () => {
    await createWorkspace();
    const gitDir = resolveGitDirSync(worktree);
    expect(gitDir).toContain(path.join(".git", "worktrees"));
    expect(fs.existsSync(path.join(gitDir, "HEAD"))).toBe(true);
    expect(resolveGitCommonDirSync(worktree)).toBe(path.join(repo, ".git"));
    expect(resolveGitDirSync(repo)).toBe(path.join(repo, ".git"));
  });

  it("lists branch names without worktree markers", async () => {
    const base = await createWorkspace();
    // `git branch --list` prints "+ dyad/chat-1" for a branch checked out in
    // another worktree; callers must get the bare name.
    expect((await gitListBranches({ path: repo })).sort()).toEqual([
      "dyad/chat-1",
      "main",
    ]);
    // A tag with a branch's name makes `refname:short` print
    // "heads/<name>", and a detached HEAD adds a "(HEAD detached at …)"
    // entry to `git branch --list`.
    await git(repo, ["tag", "dyad/chat-1"]);
    await git(repo, ["checkout", "--detach"]);
    expect((await gitListBranches({ path: repo })).sort()).toEqual([
      "dyad/chat-1",
      "main",
    ]);
    expect(
      (await listBranchesContaining({ path: repo, commit: base })).sort(),
    ).toEqual(["dyad/chat-1", "main"]);
  });

  it("reports nothing to do, fast-forwards, or merges without rewriting history", async () => {
    await createWorkspace();
    expect(
      await mergeIntoWorkspace({
        worktreePath: worktree,
        ref: "main",
        message: "sync",
        allowFastForward: true,
      }),
    ).toEqual({ kind: "up-to-date" });

    const ahead = await commitFile(repo, "README.md", "hello\n", "docs");
    expect(
      await mergeIntoWorkspace({
        worktreePath: worktree,
        ref: "main",
        message: "sync",
        allowFastForward: true,
      }),
    ).toEqual({ kind: "fast-forward" });
    expect(await git(worktree, ["rev-parse", "HEAD"])).toBe(ahead);

    const ours = await commitFile(worktree, "src/feature.ts", "x\n", "feature");
    const theirs = await commitFile(repo, "src/other.ts", "y\n", "other");
    const merged = await mergeIntoWorkspace({
      worktreePath: worktree,
      ref: "main",
      message: "Combine main",
      allowFastForward: false,
    });
    expect(merged.kind).toBe("merged");
    // Both histories are preserved: the merge contains each side's commit.
    expect(
      await isAncestorCommit({
        path: worktree,
        ancestor: ours,
        descendant: "HEAD",
      }),
    ).toBe(true);
    expect(
      await isAncestorCommit({
        path: worktree,
        ancestor: theirs,
        descendant: "HEAD",
      }),
    ).toBe(true);
    expect(
      await listCommitsNotIn({ path: worktree, from: "HEAD", exclude: "main" }),
    ).toHaveLength(2);
  });

  it("leaves a conflicted merge in progress that linked-worktree checks can see", async () => {
    await createWorkspace();
    await commitFile(worktree, "src/App.tsx", "line 1\nOURS\nline 3\n", "ours");
    await commitFile(repo, "src/App.tsx", "line 1\nTHEIRS\nline 3\n", "theirs");
    const result = await mergeIntoWorkspace({
      worktreePath: worktree,
      ref: "main",
      message: "Combine main",
      allowFastForward: false,
    });
    expect(result).toEqual({
      kind: "conflicts",
      conflictedFiles: ["src/App.tsx"],
    });
    expect(isMergeInProgress(worktree)).toBe(true);
    // Also from an app folder inside the checkout.
    expect(isMergeInProgress(path.join(worktree, "src"))).toBe(true);
    // These previously looked for `<worktree>/.git/MERGE_HEAD`, which never
    // exists in a linked worktree.
    expect(isGitMergeInProgress({ path: worktree })).toBe(true);
    expect(isGitMergeOrRebaseInProgress({ path: worktree })).toBe(true);
    // An app in a subfolder of its checkout has no `.git` of its own.
    expect(isGitMergeInProgress({ path: path.join(worktree, "src") })).toBe(
      true,
    );
    expect(
      isGitMergeOrRebaseInProgress({ path: path.join(worktree, "src") }),
    ).toBe(true);
    expect(isGitMergeInProgress({ path: repo })).toBe(false);
    expect(isGitMergeInProgress({ path: path.join(repo, "src") })).toBe(false);
    expect(
      (await inspectRepositoryHealth({ path: worktree })).operationInProgress,
    ).toBe("merge");

    expect(
      await findFilesWithConflictMarkers(worktree, ["src/App.tsx"]),
    ).toEqual(["src/App.tsx"]);
    await fs.promises.writeFile(
      path.join(worktree, "src/App.tsx"),
      "line 1\nOURS and THEIRS\nline 3\n",
    );
    expect(
      await findFilesWithConflictMarkers(worktree, ["src/App.tsx"]),
    ).toEqual([]);
    // A Markdown heading underline is content, not a leftover separator.
    await fs.promises.writeFile(
      path.join(worktree, "README.md"),
      "Welcome\n=======\n\nText.\n",
    );
    expect(await findFilesWithConflictMarkers(worktree, ["README.md"])).toEqual(
      [],
    );
    await fs.promises.rm(path.join(worktree, "README.md"));
    // A file the resolution deleted has no markers left to find.
    expect(await findFilesWithConflictMarkers(worktree, ["README.md"])).toEqual(
      [],
    );
    await stageAllChanges(worktree);
    const mergeCommit = await commitInProgressMerge(worktree);
    expect(isMergeInProgress(worktree)).toBe(false);
    expect(await git(worktree, ["rev-parse", "HEAD"])).toBe(mergeCommit);
    expect(
      (await git(worktree, ["log", "-1", "--format=%P"])).split(" "),
    ).toHaveLength(2);
  });

  it("finds conflict markers in files too large to read whole", async () => {
    // Over the whole-file limit, with the marker straddling a 1 MiB chunk.
    const filler = "x".repeat(1024 * 1024 - 3) + "\n";
    const big = path.join(repo, "big.txt");
    await fs.promises.writeFile(
      big,
      filler.repeat(2) + "<<<<<<< HEAD\nours\n=======\n" + filler,
    );
    const clean = path.join(repo, "clean.txt");
    await fs.promises.writeFile(clean, filler.repeat(3) + "=======\n");
    const binary = path.join(repo, "binary.bin");
    await fs.promises.writeFile(
      binary,
      Buffer.concat([Buffer.from([0]), Buffer.from(filler.repeat(3))]),
    );
    await fs.promises.appendFile(binary, "<<<<<<< HEAD\n");

    expect(
      await findFilesWithConflictMarkers(repo, [
        "big.txt",
        "clean.txt",
        "binary.bin",
      ]),
    ).toEqual(["big.txt"]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "fails instead of passing a conflicted file it cannot read",
    async () => {
      const unreadable = path.join(repo, "src/App.tsx");
      await fs.promises.writeFile(unreadable, "<<<<<<< HEAD\nours\n");
      await fs.promises.chmod(unreadable, 0o000);
      try {
        await expect(
          findFilesWithConflictMarkers(repo, ["src/App.tsx"]),
        ).rejects.toMatchObject({ code: "EACCES" });
      } finally {
        await fs.promises.chmod(unreadable, 0o644);
      }
    },
  );

  it("fast-forwards the target only to a result that contains it", async () => {
    await createWorkspace();
    const work = await commitFile(worktree, "src/feature.ts", "x\n", "feature");
    await fastForwardCheckedOutBranch({ worktreePath: repo, ref: work });
    expect(await git(repo, ["rev-parse", "main"])).toBe(work);
    expect(fs.existsSync(path.join(repo, "src/feature.ts"))).toBe(true);

    await commitFile(repo, "src/main-only.ts", "z\n", "main moved");
    const diverged = await commitFile(worktree, "src/more.ts", "m\n", "more");
    await expect(
      fastForwardCheckedOutBranch({ worktreePath: repo, ref: diverged }),
    ).rejects.toThrow();
  });

  it("lands a worktree as one squash and records it so later merges start from it", async () => {
    const base = await createWorkspace();
    await commitFile(
      worktree,
      "src/App.tsx",
      "line 1\nchanged once\nline 3\n",
      "first",
    );
    await commitFile(worktree, "src/extra.ts", "e\n", "second");
    const head = await git(worktree, ["rev-parse", "HEAD"]);

    const squash = await createSquashCommit({
      path: repo,
      source: head,
      parent: base,
      message: "Add extra\n\nDyad-Chat: 1",
    });
    expect(await git(repo, ["rev-parse", `${squash}^`])).toBe(base);
    expect(await haveSameTree({ path: repo, a: squash, b: head })).toBe(true);
    expect(await getCommitSubject({ path: repo, ref: squash })).toBe(
      "Add extra",
    );
    // Creating it moves no branch or checkout.
    expect(await git(repo, ["rev-parse", "main"])).toBe(base);
    await fastForwardCheckedOutBranch({ worktreePath: repo, ref: squash });
    expect(fs.readFileSync(path.join(repo, "src/App.tsx"), "utf8")).toContain(
      "changed once",
    );

    const recorded = await recordMergedCommit({
      worktreePath: worktree,
      commit: squash,
      message: "Record squash",
    });
    expect(await haveSameTree({ path: worktree, a: recorded, b: head })).toBe(
      true,
    );
    expect(
      await isAncestorCommit({
        path: worktree,
        ancestor: squash,
        descendant: recorded,
      }),
    ).toBe(true);
    expect(
      await recordMergedCommit({
        worktreePath: worktree,
        commit: squash,
        message: "Record squash",
      }),
    ).toBe(recorded);

    // Changing the same line again does not conflict with the earlier squash.
    await commitFile(
      worktree,
      "src/App.tsx",
      "line 1\nchanged twice\nline 3\n",
      "third",
    );
    await commitFile(repo, "src/other.ts", "o\n", "other chat");
    expect(
      (
        await mergeIntoWorkspace({
          worktreePath: worktree,
          ref: "main",
          message: "Combine main",
          allowFastForward: false,
        })
      ).kind,
    ).toBe("merged");
    expect(
      fs.readFileSync(path.join(worktree, "src/App.tsx"), "utf8"),
    ).toContain("changed twice");

    // Git never sees a squashed branch as merged, and this one has work
    // ("changed twice") that is not on main.
    await removeLinkedWorktree({
      repositoryPath: repo,
      worktreePath: worktree,
    });
    expect(
      await deleteMergedBranch({ repositoryPath: repo, branch: "dyad/chat-1" }),
    ).toBe(false);
    expect(
      await forceDeleteBranch({ repositoryPath: repo, branch: "dyad/chat-1" }),
    ).toBe(true);
    expect(await gitBranchExists({ path: repo, branch: "dyad/chat-1" })).toBe(
      false,
    );
  });

  it("lists uncommitted paths and tells when the repository ignores .dyad", async () => {
    await createWorkspace();
    await fs.promises.writeFile(
      path.join(worktree, "src/App.tsx"),
      "changed\n",
    );
    await fs.promises.writeFile(path.join(worktree, "new.txt"), "new\n");
    expect((await listUncommittedPaths(worktree)).sort()).toEqual([
      "new.txt",
      "src/App.tsx",
    ]);

    expect(isDyadMetadataExcludedSync(repo)).toBe(false);
    await excludeDyadMetadata(worktree);
    // Shared by the app's own checkout and every worktree.
    expect(isDyadMetadataExcludedSync(repo)).toBe(true);
    expect(isDyadMetadataExcludedSync(worktree)).toBe(true);
  });

  it("reads uncommitted paths without writing the index or running fsmonitor", async () => {
    await createWorkspace();
    // Stale stat data makes a plain `git status` save a refreshed index,
    // which takes index.lock while a turn may be staging in this worktree.
    const tracked = path.join(worktree, "src/App.tsx");
    const past = new Date("2020-01-01T00:00:00Z");
    await fs.promises.utimes(tracked, past, past);
    const indexPath = path.join(resolveGitDirSync(worktree), "index");
    const indexBefore = await fs.promises.readFile(indexPath);
    if (process.platform !== "win32") {
      const marker = path.join(root, "fsmonitor-ran");
      const hook = path.join(root, "fsmonitor.sh");
      await fs.promises.writeFile(
        hook,
        `#!/bin/sh\ntouch "${marker}"\nexit 1\n`,
        { mode: 0o755 },
      );
      await git(repo, ["config", "core.fsmonitor", hook]);
      expect(await listUncommittedPaths(worktree)).toEqual([]);
      expect(fs.existsSync(marker)).toBe(false);
    } else {
      expect(await listUncommittedPaths(worktree)).toEqual([]);
    }
    expect((await fs.promises.readFile(indexPath)).equals(indexBefore)).toBe(
      true,
    );
  });

  it("restores a branch's worktree without running the repository's hooks", async () => {
    await git(repo, ["branch", "dyad/chat-1"]);
    const marker = path.join(root, "hook-ran");
    const hook = path.join(repo, ".git", "hooks", "post-checkout");
    await fs.promises.mkdir(path.dirname(hook), { recursive: true });
    await fs.promises.writeFile(
      hook,
      `#!/bin/sh\necho ran > "${marker.split(path.sep).join("/")}"\n`,
    );
    await fs.promises.chmod(hook, 0o755);

    await checkoutBranchWorktree({
      repositoryPath: repo,
      worktreePath: worktree,
      branch: "dyad/chat-1",
    });
    expect(await git(worktree, ["branch", "--show-current"])).toBe(
      "dyad/chat-1",
    );
    expect(fs.existsSync(path.join(worktree, "src/App.tsx"))).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("undoes a chat's own commits without touching other work", async () => {
    await createWorkspace();
    const own = await commitFile(worktree, "src/feature.ts", "x\n", "feature");
    // Other work integrated into the workspace after the chat's commit.
    await commitFile(repo, "src/other.ts", "y\n", "other");
    await mergeIntoWorkspace({
      worktreePath: worktree,
      ref: "main",
      message: "Combine main",
      allowFastForward: false,
    });
    const undo = await revertCommitsAsOne({
      worktreePath: worktree,
      commits: [own],
      message: "Undo feature",
    });
    expect(undo).toMatch(/^[0-9a-f]{40,64}$/);
    expect(fs.existsSync(path.join(worktree, "src/feature.ts"))).toBe(false);
    expect(fs.existsSync(path.join(worktree, "src/other.ts"))).toBe(true);
  });

  it("writes back tracked files a failed removal deleted, keeping edits", async () => {
    await commitFile(repo, "README.md", "hello\n", "docs");
    await createWorkspace();
    await fs.promises.writeFile(path.join(worktree, "src/App.tsx"), "edited\n");
    await fs.promises.rm(path.join(worktree, "README.md"));

    expect(await restoreMissingTrackedFiles(worktree)).toBe(true);
    expect(fs.existsSync(path.join(worktree, "README.md"))).toBe(true);
    expect(fs.readFileSync(path.join(worktree, "src/App.tsx"), "utf8")).toBe(
      "edited\n",
    );
  });

  it("deletes a branch whose work was squashed into the checked-out branch", async () => {
    await createWorkspace();
    const base = await git(repo, ["rev-parse", "main"]);
    const head = await commitFile(worktree, "src/feature.ts", "x\n", "feature");
    const squash = await createSquashCommit({
      path: repo,
      source: head,
      parent: base,
      message: "Add feature",
    });
    await fastForwardCheckedOutBranch({ worktreePath: repo, ref: squash });
    await recordMergedCommit({
      worktreePath: worktree,
      commit: squash,
      message: "Record squash",
    });
    await removeLinkedWorktree({
      repositoryPath: repo,
      worktreePath: worktree,
    });

    expect(
      await deleteMergedBranch({ repositoryPath: repo, branch: "dyad/chat-1" }),
    ).toBe(true);
    expect(await gitBranchExists({ path: repo, branch: "dyad/chat-1" })).toBe(
      false,
    );
  });

  it("removes a workspace and only deletes a fully merged branch", async () => {
    await createWorkspace();
    const work = await commitFile(worktree, "src/feature.ts", "x\n", "feature");
    expect(
      await deleteMergedBranch({ repositoryPath: repo, branch: "dyad/chat-1" }),
    ).toBe(false);
    await removeLinkedWorktree({
      repositoryPath: repo,
      worktreePath: worktree,
    });
    expect(fs.existsSync(worktree)).toBe(false);
    // Unmerged commits stay reachable on the branch.
    expect(await git(repo, ["rev-parse", "dyad/chat-1"])).toBe(work);
    await fastForwardCheckedOutBranch({ worktreePath: repo, ref: work });
    expect(
      await deleteMergedBranch({ repositoryPath: repo, branch: "dyad/chat-1" }),
    ).toBe(true);
  });
  it("reconnects a workspace after the app's folder is copied elsewhere", async () => {
    await createWorkspace();
    // Renaming or relocating an app copies its folder and deletes the old one.
    const moved = path.join(root, "moved-app");
    await fs.promises.cp(repo, moved, { recursive: true });
    await fs.promises.rm(repo, { recursive: true, force: true });
    expect(isWorktreeLinkBroken(worktree)).toBe(true);
    expect(isWorktreeLinkBroken(moved)).toBe(false);

    await repairLinkedWorktrees({
      repositoryPath: moved,
      worktreePaths: [worktree],
    });
    expect(isWorktreeLinkBroken(worktree)).toBe(false);
    expect(await git(worktree, ["branch", "--show-current"])).toBe(
      "dyad/chat-1",
    );
    expect(resolveGitCommonDirSync(worktree)).toBe(path.join(moved, ".git"));
    expect((await listGitWorktrees(moved)).map((entry) => entry.path)).toEqual([
      moved,
      worktree,
    ]);
  });
  it("splits changed and deleted files relative to an app folder", async () => {
    const base = await commitFile(repo, "web/src/old.ts", "old\n", "web app");
    await commitFile(repo, "other/readme.md", "x\n", "unrelated");
    await fs.promises.rm(path.join(repo, "web/src/old.ts"));
    await commitFile(repo, "web/src/new.ts", "new\n", "replace");
    // From the app's own folder inside the repository.
    expect(
      await diffPathsByStatus({
        path: path.join(repo, "web"),
        from: base,
        to: "HEAD",
      }),
    ).toEqual({ changed: ["src/new.ts"], deleted: ["src/old.ts"] });
  });
  it("keeps untracked .dyad metadata out of every worktree without touching tracked files", async () => {
    await commitFile(repo, ".dyad/rules.md", "tracked\n", "track a rule");
    await createWorkspace();
    await excludeDyadMetadata(worktree);
    await excludeDyadMetadata(worktree);
    for (const checkout of [repo, worktree]) {
      await fs.promises.mkdir(path.join(checkout, ".dyad/media"), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(checkout, ".dyad/media/a.png"),
        "x",
      );
      expect(await git(checkout, ["status", "--porcelain"])).toBe("");
    }
    // Tracked files under .dyad are still tracked.
    await fs.promises.writeFile(
      path.join(worktree, ".dyad/rules.md"),
      "edited\n",
    );
    expect(await git(worktree, ["status", "--porcelain"])).toBe(
      "M .dyad/rules.md",
    );
    expect(
      (
        await fs.promises.readFile(path.join(repo, ".git/info/exclude"), "utf8")
      ).match(/^\.dyad\/$/gm),
    ).toHaveLength(1);
    expect(await git(repo, ["status", "--porcelain"])).toBe("");
  });
});
