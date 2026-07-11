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
  getGitUncommittedFiles,
  getGitUncommittedFilesWithStatus,
} from "@/ipc/utils/git_utils";

const execFileAsync = promisify(execFile);

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
    await fs.promises.writeFile(path.join(repoDir, "src.ts"), "user change");

    await expect(
      getGitUncommittedFilesWithStatus({ path: repoDir }),
    ).resolves.toEqual([{ path: "src.ts", status: "added" }]);
  });
});
