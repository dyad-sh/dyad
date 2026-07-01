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
  ensureGitLineEndingPolicy,
  gitListFilesNative,
  getGitUncommittedFiles,
  getGitUncommittedFilesWithStatus,
  gitCheckout,
} from "@/ipc/utils/git_utils";
import { readSettings } from "@/main/settings";

const execFileAsync = promisify(execFile);

async function runGit(repoDir: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repoDir });
}

async function runGitStdout(repoDir: string, args: string[]): Promise<string> {
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
    vi.mocked(readSettings).mockReturnValue({ enableNativeGit: true } as any);
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
      runGitStdout(repoDir, ["config", "--local", "core.autocrlf"]),
    ).resolves.toBe("false");
    await expect(
      runGitStdout(repoDir, ["config", "--local", "core.eol"]),
    ).resolves.toBe("lf");
    await expect(
      runGitStdout(repoDir, ["config", "--local", "core.safecrlf"]),
    ).resolves.toBe("warn");
  });

  it("does not overwrite an existing gitattributes file", async () => {
    vi.mocked(readSettings).mockReturnValue({ enableNativeGit: false } as any);
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
    vi.mocked(readSettings).mockReturnValue({ enableNativeGit: false } as any);
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
    vi.mocked(readSettings).mockReturnValue({ enableNativeGit: true } as any);
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));

    await runGit(repoDir, ["init"]);
    await ensureGitLineEndingPolicy({ path: repoDir });
    await runGit(repoDir, ["config", "--local", "core.eol", "crlf"]);

    await ensureGitLineEndingPolicy({ path: repoDir });

    await expect(
      runGitStdout(repoDir, ["config", "--local", "core.eol"]),
    ).resolves.toBe("crlf");
  });
});

/**
 * Builds a repo where `pnpm-workspace.yaml` is tracked at the first commit but
 * has since been untracked (git rm --cached) and left on disk. Checking out the
 * first commit then hits git's "untracked working tree files would be
 * overwritten" abort. Returns the first commit's hash.
 */
async function setupRepoWithUntrackedManagedFile(
  repoDir: string,
): Promise<string> {
  await runGit(repoDir, ["init"]);
  await runGit(repoDir, ["config", "user.email", "test@dyad.sh"]);
  await runGit(repoDir, ["config", "user.name", "Dyad Test"]);

  await fs.promises.writeFile(path.join(repoDir, "app.txt"), "v1");
  await fs.promises.writeFile(
    path.join(repoDir, "pnpm-workspace.yaml"),
    "onlyBuiltDependencies:\n  - esbuild\n",
  );
  await runGit(repoDir, ["add", "."]);
  await runGit(repoDir, ["commit", "-m", "first"]);
  const firstCommit = await runGitStdout(repoDir, ["rev-parse", "HEAD"]);

  // Untrack pnpm-workspace.yaml (kept on disk -> now untracked) and commit the
  // removal so HEAD no longer tracks it.
  await runGit(repoDir, ["rm", "--cached", "pnpm-workspace.yaml"]);
  await runGit(repoDir, ["commit", "-m", "untrack pnpm-workspace.yaml"]);

  return firstCommit;
}

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
    vi.mocked(readSettings).mockReturnValue({ enableNativeGit: true } as any);
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
    vi.mocked(readSettings).mockReturnValue({ enableNativeGit: true } as any);
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

    await expect(
      getGitUncommittedFilesWithStatus({ path: repoDir }),
    ).resolves.toEqual([{ path: "src.ts", status: "added" }]);
  });
});

describe("gitCheckout", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  it("removes a blocking untracked Dyad-managed file and checks out", async () => {
    vi.mocked(readSettings).mockReturnValue({ enableNativeGit: true } as any);
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));

    const firstCommit = await setupRepoWithUntrackedManagedFile(repoDir);

    await expect(
      gitCheckout({ path: repoDir, ref: firstCommit }),
    ).resolves.toBeUndefined();

    // HEAD is now at the first commit and its tracked pnpm-workspace.yaml content
    // was restored over the removed untracked one.
    const head = await runGitStdout(repoDir, ["rev-parse", "HEAD"]);
    expect(head).toEqual(firstCommit);
    expect(
      await fs.promises.readFile(
        path.join(repoDir, "pnpm-workspace.yaml"),
        "utf8",
      ),
    ).toEqual("onlyBuiltDependencies:\n  - esbuild\n");
  });

  it("does not delete a blocking user-visible untracked file and throws", async () => {
    vi.mocked(readSettings).mockReturnValue({ enableNativeGit: true } as any);
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));

    await runGit(repoDir, ["init"]);
    await runGit(repoDir, ["config", "user.email", "test@dyad.sh"]);
    await runGit(repoDir, ["config", "user.name", "Dyad Test"]);

    await fs.promises.writeFile(path.join(repoDir, "app.txt"), "v1");
    await fs.promises.writeFile(path.join(repoDir, "user.txt"), "tracked");
    await runGit(repoDir, ["add", "."]);
    await runGit(repoDir, ["commit", "-m", "first"]);
    const firstCommit = await runGitStdout(repoDir, ["rev-parse", "HEAD"]);

    await runGit(repoDir, ["rm", "--cached", "user.txt"]);
    await runGit(repoDir, ["commit", "-m", "untrack user.txt"]);
    await fs.promises.writeFile(path.join(repoDir, "user.txt"), "my work");

    await expect(
      gitCheckout({ path: repoDir, ref: firstCommit }),
    ).rejects.toThrow(/Failed to checkout ref/);

    // The user-visible untracked file is left untouched.
    expect(
      await fs.promises.readFile(path.join(repoDir, "user.txt"), "utf8"),
    ).toEqual("my work");
  });

  it("does not delete a blocking .dyad file and throws", async () => {
    // .dyad/* is hidden from the uncommitted-files UI but holds real user data
    // (chat history, todos, generated media), so it must NOT be auto-deleted to
    // unblock a checkout the way pnpm-workspace.yaml is.
    vi.mocked(readSettings).mockReturnValue({ enableNativeGit: true } as any);
    repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "git-utils-"));

    await runGit(repoDir, ["init"]);
    await runGit(repoDir, ["config", "user.email", "test@dyad.sh"]);
    await runGit(repoDir, ["config", "user.name", "Dyad Test"]);

    await fs.promises.mkdir(path.join(repoDir, ".dyad", "media"), {
      recursive: true,
    });
    await fs.promises.writeFile(path.join(repoDir, "app.txt"), "v1");
    await fs.promises.writeFile(
      path.join(repoDir, ".dyad", "media", "hero.png"),
      "generated-image",
    );
    await runGit(repoDir, ["add", "."]);
    await runGit(repoDir, ["commit", "-m", "first"]);
    const firstCommit = await runGitStdout(repoDir, ["rev-parse", "HEAD"]);

    await runGit(repoDir, ["rm", "--cached", ".dyad/media/hero.png"]);
    await runGit(repoDir, ["commit", "-m", "untrack .dyad media"]);
    await fs.promises.writeFile(
      path.join(repoDir, ".dyad", "media", "hero.png"),
      "my unsaved image",
    );

    await expect(
      gitCheckout({ path: repoDir, ref: firstCommit }),
    ).rejects.toThrow(/Failed to checkout ref/);

    // The .dyad data is left untouched rather than deleted.
    expect(
      await fs.promises.readFile(
        path.join(repoDir, ".dyad", "media", "hero.png"),
        "utf8",
      ),
    ).toEqual("my unsaved image");
  });
});
