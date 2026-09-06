import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
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

import { isPathIgnoredByGitIgnore } from "@/ipc/utils/gitignore_utils";

const execFileAsync = promisify(execFile);

type GitignoreSpec = { dir?: string; content: string };
type OracleCase = {
  name: string;
  gitignores: GitignoreSpec[];
  probe: string;
  isDir: boolean;
};

function makeTempRepo(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeGitignores(
  repoDir: string,
  gitignores: GitignoreSpec[],
): Promise<void> {
  for (const spec of gitignores) {
    const dir = spec.dir ?? "";
    const absDir = dir === "" ? repoDir : path.join(repoDir, dir);
    await fs.mkdir(absDir, { recursive: true });
    await fs.writeFile(path.join(absDir, ".gitignore"), spec.content);
  }
}

async function createProbe(
  repoDir: string,
  probe: string,
  isDir: boolean,
): Promise<void> {
  const abs = path.join(repoDir, probe);
  if (isDir) {
    await fs.mkdir(abs, { recursive: true });
    return;
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, "probe-content");
}

async function isIgnored(
  repoDir: string,
  probe: string,
  isDir = false,
): Promise<boolean> {
  return isPathIgnoredByGitIgnore({
    basePath: repoDir,
    filePath: path.join(repoDir, probe),
    isDirectory: isDir,
  });
}

async function gitIsIgnored(repoDir: string, probe: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["check-ignore", "--", probe],
      { cwd: repoDir },
    );
    return stdout.trim() !== "";
  } catch (error) {
    const code = (error as { code?: number }).code;
    // git check-ignore exits 1 when the path is NOT ignored.
    if (code === 1) {
      return false;
    }
    throw error;
  }
}

async function initRepo(repoDir: string): Promise<void> {
  await execFileAsync("git", ["init", "-q"], { cwd: repoDir });
}

describe("isPathIgnoredByGitIgnore directory re-include", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempRepo("dyad-gitignore-utils-");
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true, maxRetries: 3 });
  });

  it("re-includes a directory ignored by an ancestor so files inside are not ignored", async () => {
    // The headline bug: a nested .gitignore's `!dist/` must lift an ancestor's
    // `dist/` so files inside the directory are not ignored. Real Git honors
    // this; the per-instance reducer previously did not.
    await writeGitignores(repoDir, [
      { content: "dist/\n" },
      { dir: "app", content: "!dist/\n" },
    ]);
    await createProbe(repoDir, "app/dist/keep.txt", false);

    await expect(isIgnored(repoDir, "app/dist/keep.txt")).resolves.toBe(false);
  });

  it("returns false for paths outside the basePath", async () => {
    await writeGitignores(repoDir, [{ content: "dist\n" }]);
    await createProbe(repoDir, "dist/keep.txt", false);

    await expect(
      isPathIgnoredByGitIgnore({ basePath: repoDir, filePath: repoDir }),
    ).resolves.toBe(false);
    await expect(
      isPathIgnoredByGitIgnore({
        basePath: repoDir,
        filePath: path.join(os.tmpdir(), "outside.txt"),
      }),
    ).resolves.toBe(false);
  });

  it("matches real git check-ignore across a parametrized matrix", async () => {
    await initRepo(repoDir);
    const cases: OracleCase[] = [
      {
        name: "no-slash re-include",
        gitignores: [{ content: "dist\n" }, { dir: "app", content: "!dist\n" }],
        probe: "app/dist/keep.txt",
        isDir: false,
      },
      {
        name: "trailing-slash re-include",
        gitignores: [
          { content: "dist/\n" },
          { dir: "app", content: "!dist/\n" },
        ],
        probe: "app/dist/keep.txt",
        isDir: false,
      },
      {
        name: "leading-slash re-include",
        gitignores: [
          { content: "/dist/\n" },
          { dir: "app", content: "!/dist/\n" },
        ],
        probe: "app/dist/keep.txt",
        isDir: false,
      },
      {
        name: "deep re-include",
        gitignores: [{ content: "dist\n" }, { dir: "a", content: "!dist\n" }],
        probe: "a/b/dist/keep.txt",
        isDir: false,
      },
      {
        name: "double-glob re-include",
        gitignores: [
          { content: "**/cache\n" },
          { dir: "app", content: "!cache\n" },
        ],
        probe: "app/cache/keep.txt",
        isDir: false,
      },
      {
        name: "space-named re-include",
        gitignores: [
          { content: "my dir/\n" },
          { dir: "app", content: "!my dir/\n" },
        ],
        probe: "app/my dir/keep.txt",
        isDir: false,
      },
      {
        name: "file re-include under ignored parent stays ignored",
        gitignores: [
          { content: "private/\n" },
          { dir: "private", content: "!credentials.ts\n" },
        ],
        probe: "private/credentials.ts",
        isDir: false,
      },
      {
        name: "re-applies child file pattern inside re-included dir",
        gitignores: [
          { content: "dist\n" },
          { dir: "app", content: "!dist\ndist/*.tmp\n" },
        ],
        probe: "app/dist/junk.tmp",
        isDir: false,
      },
      {
        name: "re-applies ancestor file pattern inside re-included dir",
        gitignores: [
          { content: "dist\n*.tmp\n" },
          { dir: "app", content: "!dist\n" },
        ],
        probe: "app/dist/junk.tmp",
        isDir: false,
      },
      {
        name: "unrelated negation is a no-op",
        gitignores: [
          { content: "dist\n" },
          { dir: "app", content: "!build\n" },
        ],
        probe: "app/dist/keep.txt",
        isDir: false,
      },
      {
        name: "baseline ignore without re-include",
        gitignores: [{ content: "dist\n" }],
        probe: "app/dist/keep.txt",
        isDir: false,
      },
      {
        name: "baseline no rules",
        gitignores: [],
        probe: "app/dist/keep.txt",
        isDir: false,
      },
      {
        name: "re-included directory itself is not ignored",
        gitignores: [{ content: "dist\n" }, { dir: "app", content: "!dist\n" }],
        probe: "app/dist",
        isDir: true,
      },
      {
        name: "ignored directory itself is ignored",
        gitignores: [{ content: "dist/\n" }],
        probe: "app/dist",
        isDir: true,
      },
      {
        name: "scoped re-include does not affect sibling dirs",
        gitignores: [{ content: "dist\n" }, { dir: "app", content: "!dist\n" }],
        probe: "other/dist/keep.txt",
        isDir: false,
      },
      {
        name: "nested mid-slash negation is scoped",
        gitignores: [
          { content: "build/\n" },
          { dir: "app/src", content: "!build/\n" },
        ],
        probe: "app/src/build/keep.txt",
        isDir: false,
      },
    ];

    for (const testCase of cases) {
      await writeGitignores(repoDir, testCase.gitignores);
      await createProbe(repoDir, testCase.probe, testCase.isDir);
      const expected = await gitIsIgnored(repoDir, testCase.probe);
      const actual = await isIgnored(repoDir, testCase.probe, testCase.isDir);
      expect(actual, `matrix case "${testCase.name}"`).toBe(expected);
    }
  });
});
