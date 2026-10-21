import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  collectPushBaseline,
  collectSyncSnapshot,
  measurePush,
} from "./git_sync_diagnostics";
import { getGitUncommittedFiles } from "./git_utils";
import { classifyPushOutcome } from "@/github_ops/push_summary";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test User",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd },
  );
  return stdout.trim();
}

/**
 * A working repository with one commit on `main`, pushed to a bare "remote"
 * next to it. Dyad's push command is then `git push origin main:main`.
 */
async function createRepoWithRemote(): Promise<{ root: string; work: string }> {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "git-sync-diagnostics-"),
  );
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "work");
  await git(root, "init", "-q", "--bare", remote);
  await git(root, "init", "-q", "-b", "main", work);
  await git(work, "remote", "add", "origin", remote);
  await commitFile(work, "a.txt", "one");
  await git(work, "push", "-q", "origin", "main:main");
  return { root, work };
}

async function commitFile(
  work: string,
  file: string,
  content: string,
): Promise<string> {
  await fs.promises.writeFile(path.join(work, file), `${content}\n`);
  await git(work, "add", file);
  await git(work, "commit", "-q", "-m", `write ${file}`);
  return git(work, "rev-parse", "HEAD");
}

describe("git sync diagnostics", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      await fs.promises.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      root = undefined;
    }
  });

  it("measures a push that moved the remote, with commit and file counts", async () => {
    const repo = await createRepoWithRemote();
    root = repo.root;
    await commitFile(repo.work, "b.txt", "two");
    await fs.promises.rm(path.join(repo.work, "a.txt"));
    await git(repo.work, "add", "-A");
    await git(repo.work, "commit", "-q", "-m", "remove a");
    const head = await git(repo.work, "rev-parse", "HEAD");

    const before = await collectSyncSnapshot({
      path: repo.work,
      branch: "main",
    });
    await git(repo.work, "push", "-q", "origin", "main:main");
    const measured = await measurePush({
      path: repo.work,
      branch: "main",
      before,
      baseline: { head: before.head, remoteTip: before.remoteTip },
    });

    expect(measured).toMatchObject({
      pushedBranch: "main",
      currentBranch: "main",
      head,
      remoteTip: head,
      remoteMoved: true,
      commitsPushed: 2,
      files: { added: 1, modified: 0, deleted: 1, renamed: 0 },
      uncommittedFiles: 0,
      commitsNotOnRemote: 0,
    });
    expect(classifyPushOutcome(measured)).toBe("pushed");
  });

  it("sees an up-to-date remote and counts uncommitted files", async () => {
    const repo = await createRepoWithRemote();
    root = repo.root;
    await fs.promises.writeFile(path.join(repo.work, "draft.txt"), "wip\n");

    const before = await collectSyncSnapshot({
      path: repo.work,
      branch: "main",
    });
    await git(repo.work, "push", "-q", "origin", "main:main");
    const measured = await measurePush({
      path: repo.work,
      branch: "main",
      before,
      baseline: { head: before.head, remoteTip: before.remoteTip },
    });

    expect(measured).toMatchObject({
      remoteMoved: false,
      commitsPushed: 0,
      files: null,
      uncommittedFiles: 1,
      commitsNotOnRemote: 0,
    });
    expect(classifyPushOutcome(measured)).toBe("uncommitted-changes");
  });

  it("counts uncommitted paths exactly as the Git panel lists them", async () => {
    const repo = await createRepoWithRemote();
    root = repo.root;
    // A rename counts both sides, `.dyad/` is invisible, and a C-quoted
    // non-ASCII path still counts once: the same rules as the panel listing.
    await git(repo.work, "mv", "a.txt", "b.txt");
    await fs.promises.mkdir(path.join(repo.work, ".dyad"));
    await fs.promises.writeFile(path.join(repo.work, ".dyad", "notes"), "x\n");
    await fs.promises.writeFile(path.join(repo.work, "sp ace ü.txt"), "y\n");

    const before = await collectSyncSnapshot({
      path: repo.work,
      branch: "main",
    });
    expect(before.uncommittedFiles).toBe(3);
    expect(before.uncommittedFiles).toBe(
      (await getGitUncommittedFiles({ path: repo.work })).length,
    );
  });

  it("detects work on a branch other than the one Dyad pushes", async () => {
    const repo = await createRepoWithRemote();
    root = repo.root;
    // Dyad still pushes `other`, which exists remotely, while the user's new
    // commits land on `main`: the shape that reports success and sends nothing.
    await git(repo.work, "branch", "other");
    await git(repo.work, "push", "-q", "origin", "other:other");
    await commitFile(repo.work, "b.txt", "two");
    await commitFile(repo.work, "c.txt", "three");

    const before = await collectSyncSnapshot({
      path: repo.work,
      branch: "other",
    });
    expect(before.branchesNotOnRemote).toEqual(["main"]);
    await git(repo.work, "push", "-q", "origin", "other:other");
    const measured = await measurePush({
      path: repo.work,
      branch: "other",
      before,
      baseline: { head: before.head, remoteTip: before.remoteTip },
    });

    expect(measured).toMatchObject({
      pushedBranch: "other",
      currentBranch: "main",
      remoteMoved: false,
      commitsPushed: 0,
      commitsNotOnRemote: 2,
    });
    expect(measured.remoteTip).not.toBe(measured.head);
    expect(classifyPushOutcome(measured)).toBe("wrong-branch");
  });

  it("detects commits made on a detached HEAD", async () => {
    const repo = await createRepoWithRemote();
    root = repo.root;
    await git(repo.work, "checkout", "-q", "--detach");
    await commitFile(repo.work, "b.txt", "two");

    const before = await collectSyncSnapshot({
      path: repo.work,
      branch: "main",
    });
    expect(before.currentBranch).toBeNull();
    // Git's "(HEAD detached from ...)" pseudo-branch must not be listed.
    expect(before.branchesNotOnRemote).toEqual([]);
    await git(repo.work, "push", "-q", "origin", "main:main");
    const measured = await measurePush({
      path: repo.work,
      branch: "main",
      before,
      baseline: { head: before.head, remoteTip: before.remoteTip },
    });

    expect(measured).toMatchObject({
      currentBranch: null,
      remoteMoved: false,
      commitsNotOnRemote: 1,
    });
    expect(classifyPushOutcome(measured)).toBe("detached-head");
  });

  it("counts every file on a first push to a branch the remote lacks", async () => {
    const repo = await createRepoWithRemote();
    root = repo.root;
    await git(repo.work, "checkout", "-q", "-b", "feature");
    await commitFile(repo.work, "b.txt", "two");

    const before = await collectSyncSnapshot({
      path: repo.work,
      branch: "feature",
    });
    expect(before.remoteTip).toBeNull();
    await git(repo.work, "push", "-q", "origin", "feature:feature");
    const measured = await measurePush({
      path: repo.work,
      branch: "feature",
      before,
      baseline: { head: before.head, remoteTip: before.remoteTip },
    });

    expect(measured).toMatchObject({
      remoteMoved: true,
      commitsPushed: 2,
      files: { added: 2, modified: 0, deleted: 0, renamed: 0 },
    });
    expect(classifyPushOutcome(measured)).toBe("pushed");
  });

  it("never throws when the directory is not a repository", async () => {
    root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "git-sync-diagnostics-plain-"),
    );
    const before = await collectSyncSnapshot({ path: root, branch: "main" });
    expect(before).toEqual({
      currentBranch: null,
      branchKnown: false,
      head: null,
      branchTip: null,
      remoteTip: null,
      uncommittedFiles: 0,
      branchesNotOnRemote: [],
    });
    const measured = await measurePush({
      path: root,
      branch: "main",
      before,
      baseline: { head: before.head, remoteTip: before.remoteTip },
    });
    expect(measured.remoteTip).toBeNull();
    expect(measured.head).toBe("");
    // Unreadable, not detached: the outcome must not claim a specific cause.
    expect(measured.branchKnown).toBe(false);
    expect(classifyPushOutcome(measured)).toBe("unverified");
  });
});

describe("push baseline", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      await fs.promises.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      root = undefined;
    }
  });

  it("does not count commits the pull brought down as pushed", async () => {
    const repo = await createRepoWithRemote();
    root = repo.root;
    // A collaborator moves the remote; this clone has nothing new.
    const other = path.join(repo.root, "other");
    await git(
      repo.root,
      "clone",
      "-q",
      "-b",
      "main",
      path.join(repo.root, "remote.git"),
      other,
    );
    await commitFile(other, "theirs.txt", "from a collaborator");
    await git(other, "push", "-q", "origin", "main:main");

    const before = await collectSyncSnapshot({
      path: repo.work,
      branch: "main",
    });
    await git(repo.work, "pull", "-q", "--rebase=false", "origin", "main");
    const baseline = await collectPushBaseline({
      path: repo.work,
      branch: "main",
      before,
      remoteBranchMissing: false,
    });
    expect(baseline.remoteTip).not.toBe(before.remoteTip);
    expect(baseline.head).toBe(baseline.remoteTip);
    await git(repo.work, "push", "-q", "origin", "main:main");
    const measured = await measurePush({
      path: repo.work,
      branch: "main",
      before,
      baseline,
    });

    expect(measured).toMatchObject({
      remoteMoved: false,
      commitsPushed: 0,
      commitsNotOnRemote: 0,
    });
    expect(classifyPushOutcome(measured)).toBe("up-to-date");
  });

  it("ignores a tracking ref the remote no longer has", async () => {
    const repo = await createRepoWithRemote();
    root = repo.root;
    // The remote lost its branch (or the repository was re-linked elsewhere),
    // but `origin/main` still points at the old tip, which equals HEAD.
    await git(
      repo.root,
      "--git-dir",
      path.join(repo.root, "remote.git"),
      "update-ref",
      "-d",
      "refs/heads/main",
    );

    const before = await collectSyncSnapshot({
      path: repo.work,
      branch: "main",
    });
    expect(before.remoteTip).toBe(before.head);
    const baseline = await collectPushBaseline({
      path: repo.work,
      branch: "main",
      before,
      remoteBranchMissing: true,
    });
    expect(baseline.remoteTip).toBeNull();
    await git(repo.work, "push", "-q", "origin", "main:main");
    const measured = await measurePush({
      path: repo.work,
      branch: "main",
      before,
      baseline,
    });

    expect(measured).toMatchObject({
      remoteMoved: true,
      commitsPushed: 1,
      files: { added: 1, modified: 0, deleted: 0, renamed: 0 },
    });
    expect(classifyPushOutcome(measured)).toBe("pushed");
  });

  it("counts a renamed file as renamed", async () => {
    const repo = await createRepoWithRemote();
    root = repo.root;
    await git(repo.work, "mv", "a.txt", "renamed.txt");
    await git(repo.work, "commit", "-q", "-m", "rename");

    const before = await collectSyncSnapshot({
      path: repo.work,
      branch: "main",
    });
    await git(repo.work, "push", "-q", "origin", "main:main");
    const measured = await measurePush({
      path: repo.work,
      branch: "main",
      before,
      baseline: { head: before.head, remoteTip: before.remoteTip },
    });

    expect(measured.files).toEqual({
      added: 0,
      modified: 0,
      deleted: 0,
      renamed: 1,
    });
  });
});
