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

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(),
}));

import {
  getChangedFilesForCommit,
  getChangedFileForCommit,
  getChangedFilesForCommitBounded,
  getOldFileContent,
  getFileAtCommit,
  getFileSizeAtCommit,
  getParentCommitOid,
  gitLogNative,
} from "@/ipc/utils/git_utils";
import { readSettings } from "@/main/settings";

const execFileAsync = promisify(execFile);
const MERGE_COMMIT_TEST_TIMEOUT_MS = 15_000;

async function runGit(repoDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoDir,
    maxBuffer: 4 * 1_024 * 1_024,
  });
  return stdout.trim();
}

async function write(repoDir: string, file: string, content: string) {
  const full = path.join(repoDir, file);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, content);
}

async function commitAll(repoDir: string, message: string): Promise<string> {
  await runGit(repoDir, ["add", "-A"]);
  await runGit(repoDir, ["commit", "-m", message, "--no-gpg-sign"]);
  return runGit(repoDir, ["rev-parse", "HEAD"]);
}

// Native git relies on dugite's bundled binary which may be absent in some
// local dev environments; it is always present in CI. Run both modes so we
// guarantee native/isomorphic parity.
describe.each([
  { name: "isomorphic git", enableNativeGit: false },
  { name: "native git", enableNativeGit: true },
])("getChangedFilesForCommit ($name)", ({ enableNativeGit }) => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  async function setupRepo() {
    vi.mocked(readSettings).mockReturnValue({ enableNativeGit } as any);
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-changed-"));
    await runGit(repoDir, ["init"]);
    await runGit(repoDir, ["config", "user.email", "test@example.com"]);
    await runGit(repoDir, ["config", "user.name", "Test"]);
    return repoDir;
  }

  it("reports all files as added for the root commit", async () => {
    const dir = await setupRepo();
    await write(dir, "a.txt", "hello\n");
    await write(dir, "src/b.ts", "export const b = 1;\n");
    const root = await commitAll(dir, "init");

    const changes = await getChangedFilesForCommit({
      path: dir,
      commitHash: root,
    });

    expect(new Set(changes)).toEqual(
      new Set([
        { path: "a.txt", type: "added" },
        { path: "src/b.ts", type: "added" },
      ]),
    );
  });

  it("reports added, modified, and deleted files in a later commit", async () => {
    const dir = await setupRepo();
    await write(dir, "keep.txt", "v1\n");
    await write(dir, "remove.txt", "bye\n");
    await commitAll(dir, "init");

    await write(dir, "keep.txt", "v2\n");
    await write(dir, "new.txt", "fresh\n");
    await fs.promises.rm(path.join(dir, "remove.txt"));
    const second = await commitAll(dir, "edit");

    const changes = await getChangedFilesForCommit({
      path: dir,
      commitHash: second,
    });

    expect(new Set(changes)).toEqual(
      new Set([
        { path: "keep.txt", type: "modified" },
        { path: "new.txt", type: "added" },
        { path: "remove.txt", type: "deleted" },
      ]),
    );
  });

  it("decomposes renames into a delete + add pair", async () => {
    const dir = await setupRepo();
    await write(dir, "old-name.txt", "same content\n");
    await commitAll(dir, "init");

    await runGit(dir, ["mv", "old-name.txt", "new-name.txt"]);
    const renameCommit = await commitAll(dir, "rename");

    const changes = await getChangedFilesForCommit({
      path: dir,
      commitHash: renameCommit,
    });

    expect(new Set(changes)).toEqual(
      new Set([
        { path: "old-name.txt", type: "deleted" },
        { path: "new-name.txt", type: "added" },
      ]),
    );
  });

  it(
    "diffs merge commits against their first parent only",
    async () => {
      const dir = await setupRepo();
      await write(dir, "base.txt", "base\n");
      await commitAll(dir, "base");

      // Branch that introduces feature.txt.
      await runGit(dir, ["checkout", "-b", "feature"]);
      await write(dir, "feature.txt", "feature\n");
      await commitAll(dir, "feature adds file");

      // Back on the main line, modify base.txt so the histories diverge. This is
      // the file that `-m` (diff against all parents) would spuriously report for
      // the merge commit even though the merge did not introduce it.
      await runGit(dir, ["checkout", "-"]);
      await write(dir, "base.txt", "base-v2\n");
      await commitAll(dir, "main modifies base");

      await runGit(dir, ["merge", "--no-ff", "--no-gpg-sign", "feature"]);
      const mergeCommit = await runGit(dir, ["rev-parse", "HEAD"]);

      const changes = await getChangedFilesForCommit({
        path: dir,
        commitHash: mergeCommit,
      });

      // Only feature.txt was introduced by the merge relative to the first
      // parent; base.txt must NOT appear.
      expect(changes).toEqual([{ path: "feature.txt", type: "added" }]);
    },
    MERGE_COMMIT_TEST_TIMEOUT_MS,
  );

  it("reports both sides when a file is replaced by a directory", async () => {
    const dir = await setupRepo();
    await write(dir, "thing", "i am a file\n");
    await commitAll(dir, "thing is a file");

    // Replace the file `thing` with a directory `thing/` containing files.
    await fs.promises.rm(path.join(dir, "thing"));
    await write(dir, "thing/a.txt", "nested a\n");
    await write(dir, "thing/b.txt", "nested b\n");
    const commit = await commitAll(dir, "thing becomes a directory");

    const changes = await getChangedFilesForCommit({
      path: dir,
      commitHash: commit,
    });

    expect(new Set(changes)).toEqual(
      new Set([
        { path: "thing", type: "deleted" },
        { path: "thing/a.txt", type: "added" },
        { path: "thing/b.txt", type: "added" },
      ]),
    );
  });

  it("reports both sides when a directory is replaced by a file", async () => {
    const dir = await setupRepo();
    await write(dir, "thing/a.txt", "nested a\n");
    await write(dir, "thing/b.txt", "nested b\n");
    await commitAll(dir, "thing is a directory");

    // Replace the directory `thing/` with a single file `thing`.
    await fs.promises.rm(path.join(dir, "thing"), {
      recursive: true,
      force: true,
    });
    await write(dir, "thing", "i am a file now\n");
    const commit = await commitAll(dir, "thing becomes a file");

    const changes = await getChangedFilesForCommit({
      path: dir,
      commitHash: commit,
    });

    expect(new Set(changes)).toEqual(
      new Set([
        { path: "thing/a.txt", type: "deleted" },
        { path: "thing/b.txt", type: "deleted" },
        { path: "thing", type: "added" },
      ]),
    );
  });

  it("excludes Dyad-managed runtime files", async () => {
    const dir = await setupRepo();
    await write(dir, "app.ts", "v1\n");
    await commitAll(dir, "init");

    await write(dir, "app.ts", "v2\n");
    await write(dir, "pnpm-workspace.yaml", 'packages: ["."]\n');
    await write(dir, ".dyad/screenshot.png", "generated\n");
    const commit = await commitAll(dir, "with runtime files");

    const changes = await getChangedFilesForCommit({
      path: dir,
      commitHash: commit,
    });

    expect(changes).toEqual([{ path: "app.ts", type: "modified" }]);
  });

  it("caps changed-file metadata and reports truncation", async () => {
    const dir = await setupRepo();
    for (let index = 0; index < 5; index++) {
      await write(dir, `file-${index}.txt`, `${index}\n`);
    }
    const commit = await commitAll(dir, "many files");

    const result = await getChangedFilesForCommitBounded({
      path: dir,
      commitHash: commit,
      maxFiles: 2,
      maxPathBytes: 1_024,
      maxOutputBytes: 4_096,
    });

    expect(result.files).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("caps git stdout before a changed-path list can grow unbounded", async () => {
    const dir = await setupRepo();
    for (let index = 0; index < 5; index++) {
      await write(dir, `long-file-name-${index}.txt`, `${index}\n`);
    }
    const commit = await commitAll(dir, "many long paths");

    const result = await getChangedFilesForCommitBounded({
      path: dir,
      commitHash: commit,
      maxFiles: 100,
      maxPathBytes: 1_024,
      maxOutputBytes: 40,
    });

    expect(result.files.length).toBeLessThan(5);
    expect(result.truncated).toBe(true);
  });

  it("looks up one changed path without loading other file metadata", async () => {
    const dir = await setupRepo();
    await write(dir, "changed.txt", "before\n");
    await write(dir, "untouched.txt", "same\n");
    await commitAll(dir, "init");
    await write(dir, "changed.txt", "after\n");
    const commit = await commitAll(dir, "edit one file");

    await expect(
      getChangedFileForCommit({
        path: dir,
        commitHash: commit,
        filePath: "changed.txt",
      }),
    ).resolves.toEqual({ path: "changed.txt", type: "modified" });
    await expect(
      getChangedFileForCommit({
        path: dir,
        commitHash: commit,
        filePath: "untouched.txt",
      }),
    ).resolves.toBeNull();
  });

  it("treats an exact changed path as a literal Git pathspec", async () => {
    const dir = await setupRepo();
    await write(dir, "a!.txt", "before\n");
    await write(dir, "a?.txt", "before\n");
    await commitAll(dir, "init");
    await write(dir, "a!.txt", "after\n");
    await write(dir, "a?.txt", "after\n");
    const commit = await commitAll(dir, "edit pathspec filenames");

    await expect(
      getChangedFileForCommit({
        path: dir,
        commitHash: commit,
        filePath: "a?.txt",
      }),
    ).resolves.toEqual({ path: "a?.txt", type: "modified" });
  });

  it("reads blob size metadata without reading file content", async () => {
    const dir = await setupRepo();
    await write(dir, "large.txt", "x".repeat(20_000));
    const commit = await commitAll(dir, "large file");

    await expect(
      getFileSizeAtCommit({
        path: dir,
        filePath: "large.txt",
        commitHash: commit,
      }),
    ).resolves.toBe(20_000);
  });

  it("getOldFileContent returns parent content and null for root", async () => {
    const dir = await setupRepo();
    await write(dir, "file.txt", "first\n");
    const root = await commitAll(dir, "init");

    await write(dir, "file.txt", "second\n");
    const second = await commitAll(dir, "edit");

    // Old content of the edit commit is the root's content.
    await expect(
      getOldFileContent({
        path: dir,
        filePath: "file.txt",
        commitHash: second,
      }),
    ).resolves.toBe("first\n");
    // New content of the edit commit.
    await expect(
      getFileAtCommit({ path: dir, filePath: "file.txt", commitHash: second }),
    ).resolves.toBe("second\n");
    // Root commit has no parent.
    await expect(
      getOldFileContent({ path: dir, filePath: "file.txt", commitHash: root }),
    ).resolves.toBeNull();
    await expect(
      getParentCommitOid({ path: dir, commitHash: second }),
    ).resolves.toBe(root);
  });
});

describe("bounded version history", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  it("continues a long history from a bounded cursor page", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-pages-"));
    await runGit(repoDir, ["init"]);
    await runGit(repoDir, ["config", "user.email", "test@example.com"]);
    await runGit(repoDir, ["config", "user.name", "Test"]);
    for (let index = 0; index < 7; index++) {
      await write(repoDir, "counter.txt", `${index}\n`);
      await commitAll(repoDir, `version ${index}`);
    }

    const firstWindow = await gitLogNative(repoDir, 4);
    const firstPage = firstWindow.slice(0, 3);
    const secondWindow = await gitLogNative(repoDir, 4, "HEAD", 3);
    const secondPage = secondWindow.slice(0, 3);

    expect(firstPage).toHaveLength(3);
    expect(secondPage).toHaveLength(3);
    expect(
      new Set([...firstPage, ...secondPage].map((entry) => entry.oid)).size,
    ).toBe(6);
    expect(secondPage[0].oid).toBe(firstWindow[3].oid);
  });

  it("preserves leading whitespace without padding short commit messages", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-message-"));
    await runGit(repoDir, ["init"]);
    await runGit(repoDir, ["config", "user.email", "test@example.com"]);
    await runGit(repoDir, ["config", "user.name", "Test"]);
    const messagePath = path.join(repoDir, "message.txt");
    await fs.promises.writeFile(
      messagePath,
      "  intentionally indented subject\n\nbody\n",
    );
    await runGit(repoDir, [
      "commit",
      "--quiet",
      "--allow-empty",
      "--cleanup=verbatim",
      "--no-gpg-sign",
      "-F",
      messagePath,
    ]);

    const [commit] = await gitLogNative(repoDir, 1);

    expect(commit.commit.message).toBe(
      "  intentionally indented subject\n\nbody",
    );
  });

  it("bounds an oversized commit message while streaming git output", async () => {
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-message-"));
    await runGit(repoDir, ["init"]);
    await runGit(repoDir, ["config", "user.email", "test@example.com"]);
    await runGit(repoDir, ["config", "user.name", "Test"]);
    const messagePath = path.join(repoDir, "message.txt");
    await fs.promises.writeFile(messagePath, "x".repeat(2 * 1_024 * 1_024));
    await runGit(repoDir, [
      "commit",
      "--allow-empty",
      "--cleanup=verbatim",
      "--no-gpg-sign",
      "-F",
      messagePath,
    ]);

    const [commit] = await gitLogNative(repoDir, 1);

    expect(
      Buffer.byteLength(commit.commit.message, "utf8"),
    ).toBeLessThanOrEqual(4_100);
    expect(commit.commit.message).toMatch(/^x+$/);
  });
});
