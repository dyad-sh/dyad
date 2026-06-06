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
  getOldFileContent,
  getFileAtCommit,
} from "@/ipc/utils/git_utils";
import { readSettings } from "@/main/settings";

const execFileAsync = promisify(execFile);

async function runGit(repoDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoDir });
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
  });
});
