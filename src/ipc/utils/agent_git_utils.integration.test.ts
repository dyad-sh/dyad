import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  getAgentGitCommit,
  getAgentGitDiff,
  getAgentGitFile,
  getAgentGitLog,
  getAgentGitStatus,
  normalizeAgentGitPath,
  restoreAgentGitFile,
} from "./git_utils";

const execFileAsync = promisify(execFile);

async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repo });
  return stdout.trim();
}

describe("agent Git utilities", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-git-"));
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.name", "Test User");
    await git(repo, "config", "user.email", "test@example.com");
    await fs.promises.writeFile(path.join(repo, "file.txt"), "base\n");
    await fs.promises.writeFile(path.join(repo, ".env"), "SECRET=old\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "initial");
  });

  afterEach(async () => {
    await fs.promises.rm(repo, { recursive: true, force: true });
  });

  it("reports structured status and each diff scope", async () => {
    await fs.promises.writeFile(path.join(repo, "file.txt"), "staged\n");
    await git(repo, "add", "file.txt");
    await fs.promises.writeFile(path.join(repo, "file.txt"), "unstaged\n");
    await fs.promises.writeFile(path.join(repo, "new.txt"), "untracked\n");

    const status = await getAgentGitStatus({ path: repo });
    expect(status).toMatchObject({
      branch: "main",
      detached: false,
      staged: ["file.txt"],
      unstaged: ["file.txt"],
      untracked: ["new.txt"],
      conflicted: [],
    });
    expect(status.head).toMatch(/^[0-9a-f]{40}$/);

    const staged = await getAgentGitDiff({
      path: repo,
      scope: "staged",
    });
    expect(staged.content).toContain("+staged");
    expect(staged.content).not.toContain("+unstaged");

    const unstaged = await getAgentGitDiff({
      path: repo,
      scope: "unstaged",
    });
    expect(unstaged.content).toContain("+unstaged");

    const all = await getAgentGitDiff({ path: repo, scope: "all" });
    expect(all.content).toContain("+unstaged");
    expect(all.content).not.toContain("new.txt");

    const allFromRootAlias = await getAgentGitDiff({
      path: repo,
      scope: "all",
      filePath: ".",
    });
    expect(allFromRootAlias).toEqual(all);
  });

  it("reports detached HEAD and conflicted paths", async () => {
    await git(repo, "checkout", "-b", "other");
    await fs.promises.writeFile(path.join(repo, "file.txt"), "other\n");
    await git(repo, "commit", "-am", "other change");
    await git(repo, "checkout", "main");
    await fs.promises.writeFile(path.join(repo, "file.txt"), "main\n");
    await git(repo, "commit", "-am", "main change");
    await expect(git(repo, "merge", "other")).rejects.toThrow();

    const conflicted = await getAgentGitStatus({ path: repo });
    expect(conflicted.conflicted).toEqual(["file.txt"]);

    await git(repo, "merge", "--abort");
    const head = await git(repo, "rev-parse", "HEAD");
    await git(repo, "checkout", "--detach", head);
    const detached = await getAgentGitStatus({ path: repo });
    expect(detached).toMatchObject({ branch: null, head, detached: true });
  });

  it("bounds and marks status from very large working trees", async () => {
    const directory = path.join(repo, "many");
    await fs.promises.mkdir(directory);
    const suffix = "x".repeat(170);
    for (let start = 0; start < 3_000; start += 100) {
      await Promise.all(
        Array.from({ length: 100 }, (_, offset) =>
          fs.promises.writeFile(
            path.join(
              directory,
              `${String(start + offset).padStart(4, "0")}-${suffix}`,
            ),
            "x",
          ),
        ),
      );
    }

    const status = await getAgentGitStatus({ path: repo });
    const serialized = JSON.stringify(status, null, 2);
    expect(status.truncated).toBe(true);
    expect(status.untracked.length).toBeLessThanOrEqual(500);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(
      64 * 1024,
    );
    expect(status.untracked.every((file) => file.startsWith("many/"))).toBe(
      true,
    );
  });

  it.runIf(process.platform !== "win32")(
    "does not execute a configured fsmonitor command",
    async () => {
      const marker = path.join(repo, "fsmonitor-ran");
      const hook = path.join(repo, "fsmonitor.sh");
      await fs.promises.writeFile(
        hook,
        `#!/bin/sh\n: > '${marker}'\nprintf '0\\0'\n`,
        { mode: 0o755 },
      );
      await fs.promises.chmod(hook, 0o755);
      await git(repo, "config", "core.fsmonitor", hook);

      await getAgentGitStatus({ path: repo });

      await expect(fs.promises.access(marker)).rejects.toThrow();
    },
  );

  it("filters diffs by literal path and context", async () => {
    await fs.promises.writeFile(path.join(repo, "file.txt"), "changed\n");
    await fs.promises.writeFile(path.join(repo, "other.txt"), "base\n");
    await git(repo, "add", "other.txt");
    await git(repo, "commit", "-m", "add other");
    await fs.promises.writeFile(path.join(repo, "other.txt"), "other\n");

    const result = await getAgentGitDiff({
      path: repo,
      filePath: "file.txt",
      contextLines: 0,
    });
    expect(result.content).toContain("+changed");
    expect(result.content).not.toContain("other.txt");
    expect(result.content).not.toContain(" base");
  });

  it("preserves source and destination paths when rendering renames", async () => {
    await git(repo, "mv", "file.txt", "renamed.txt");

    const workingTreeDiff = await getAgentGitDiff({ path: repo });
    expect(workingTreeDiff.content).toContain("rename from file.txt");
    expect(workingTreeDiff.content).toContain("rename to renamed.txt");
    for (const filePath of ["file.txt", "renamed.txt"]) {
      const filtered = await getAgentGitDiff({ path: repo, filePath });
      expect(filtered.content).toContain("rename from file.txt");
      expect(filtered.content).toContain("rename to renamed.txt");
    }

    await git(repo, "commit", "-m", "rename file");
    const commit = await getAgentGitCommit({ path: repo, revision: "HEAD" });
    expect(commit.content).toContain("rename from file.txt");
    expect(commit.content).toContain("rename to renamed.txt");
    for (const filePath of ["file.txt", "renamed.txt"]) {
      const filtered = await getAgentGitCommit({
        path: repo,
        revision: "HEAD",
        filePath,
      });
      expect(filtered.content).toContain("rename from file.txt");
      expect(filtered.content).toContain("rename to renamed.txt");
    }
  });

  it("omits rename path pairs atomically at the diff path limit", async () => {
    await Promise.all(
      Array.from({ length: 499 }, (_, index) =>
        fs.promises.writeFile(
          path.join(repo, `a-${index.toString().padStart(3, "0")}.txt`),
          "",
        ),
      ),
    );
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "add empty files");
    await Promise.all(
      Array.from({ length: 499 }, (_, index) =>
        fs.promises.rm(
          path.join(repo, `a-${index.toString().padStart(3, "0")}.txt`),
        ),
      ),
    );
    await git(repo, "mv", "file.txt", "z-renamed.txt");

    const result = await getAgentGitDiff({ path: repo });

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("limited to 500 paths");
    expect(result.content).not.toContain("rename from file.txt");
    expect(result.content).not.toContain("rename to z-renamed.txt");
    expect(result.content).not.toContain("diff --git a/file.txt");
  });

  it("omits dotenv patch content", async () => {
    await fs.promises.writeFile(
      path.join(repo, ".env"),
      "SECRET=do-not-leak\n",
    );

    const result = await getAgentGitDiff({ path: repo });
    expect(result.content).toContain("Diff omitted for sensitive");
    expect(result.content).not.toContain("do-not-leak");
  });

  it("includes pnpm workspace patches while omitting Dyad-internal patches", async () => {
    await fs.promises.mkdir(path.join(repo, ".dyad"));
    await fs.promises.writeFile(
      path.join(repo, "pnpm-workspace.yaml"),
      'packages:\n  - "app"\n',
    );
    await fs.promises.writeFile(
      path.join(repo, ".dyad", "internal.json"),
      '{"version":1}\n',
    );
    await git(repo, "add", "pnpm-workspace.yaml", ".dyad/internal.json");
    await git(repo, "commit", "-m", "add workspace metadata");

    await fs.promises.writeFile(
      path.join(repo, "pnpm-workspace.yaml"),
      'packages:\n  - "app"\n  - "packages/*"\n',
    );
    await fs.promises.writeFile(
      path.join(repo, ".dyad", "internal.json"),
      '{"version":2}\n',
    );

    const result = await getAgentGitDiff({ path: repo });

    expect(result.content).toContain("pnpm-workspace.yaml");
    expect(result.content).toContain('+  - "packages/*"');
    expect(result.content).toContain("Diff omitted for sensitive");
    expect(result.content).not.toContain('{"version":2}');
  });

  it("reads logs, commit patches, and ranged historical files", async () => {
    await fs.promises.writeFile(
      path.join(repo, "file.txt"),
      "one\ntwo\nthree\n",
    );
    await git(repo, "add", "file.txt");
    await git(repo, "commit", "-m", "update file");
    const head = await git(repo, "rev-parse", "HEAD");

    const log = await getAgentGitLog({ path: repo, maxCount: 1 });
    expect(log.content).toContain(`commit ${head}`);
    expect(log.content).toContain("update file");

    const logFromRootAlias = await getAgentGitLog({
      path: repo,
      filePath: ".",
      maxCount: 1,
    });
    expect(logFromRootAlias).toEqual(log);

    const commit = await getAgentGitCommit({ path: repo, revision: head });
    expect(commit.content).toContain(`commit ${head}`);
    expect(commit.content).toContain("+one");

    const commitFromRootAlias = await getAgentGitCommit({
      path: repo,
      revision: head,
      filePath: ".",
    });
    expect(commitFromRootAlias).toEqual(commit);

    const file = await getAgentGitFile({
      path: repo,
      revision: head,
      filePath: "file.txt",
      startLine: 2,
      endLineInclusive: 2,
    });
    expect(file.content).toBe("two");
  });

  it("filters and limits logs and renders root and merge commits", async () => {
    const root = await git(repo, "rev-list", "--max-parents=0", "HEAD");
    const rootResult = await getAgentGitCommit({
      path: repo,
      revision: root,
    });
    expect(rootResult.content).toContain("+base");

    await git(repo, "checkout", "-b", "feature");
    await fs.promises.writeFile(path.join(repo, "feature.txt"), "feature\n");
    await git(repo, "add", "feature.txt");
    await git(repo, "commit", "-m", "feature commit");
    await git(repo, "checkout", "main");
    await fs.promises.writeFile(path.join(repo, "main.txt"), "main\n");
    await git(repo, "add", "main.txt");
    await git(repo, "commit", "-m", "main commit");
    await git(repo, "merge", "--no-ff", "feature", "-m", "merge feature");

    const mergeResult = await getAgentGitCommit({
      path: repo,
      revision: "HEAD",
    });
    expect(mergeResult.content).toContain("feature.txt");
    expect(mergeResult.content).not.toContain("main.txt");

    const filteredLog = await getAgentGitLog({
      path: repo,
      filePath: "feature.txt",
      maxCount: 1,
    });
    expect(filteredLog.content).toContain("feature commit");
    expect(filteredLog.content.match(/^commit /gm)).toHaveLength(1);
  });

  it("discards an incomplete log record when output is truncated", async () => {
    const messagePath = path.join(repo, "large-commit-message.txt");
    await fs.promises.writeFile(
      messagePath,
      "large subject\n\n" + "x".repeat(200_000),
    );
    await git(repo, "commit", "--allow-empty", "-F", messagePath);

    const result = await getAgentGitLog({ path: repo, maxCount: 2 });

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("Output truncated at 64 KiB");
    expect(result.content).not.toContain("commit undefined");
    expect(result.content).not.toContain("Author: undefined");
  });

  it("rejects invalid revisions and missing paths while treating pathspecs literally", async () => {
    const literalName = "literal[1].txt";
    await fs.promises.writeFile(path.join(repo, literalName), "literal\n");
    await git(repo, "--literal-pathspecs", "add", "--", literalName);
    await git(repo, "commit", "-m", "literal path");

    await expect(
      getAgentGitFile({
        path: repo,
        revision: "HEAD",
        filePath: literalName,
      }),
    ).resolves.toMatchObject({ content: "literal\n" });
    await expect(
      getAgentGitCommit({ path: repo, revision: "HEAD..HEAD" }),
    ).rejects.toThrow("Invalid Git revision");
    await expect(
      getAgentGitFile({
        path: repo,
        revision: "HEAD",
        filePath: "missing.txt",
      }),
    ).rejects.toThrow("does not exist");
  });

  it("bounds large patches with exactly one narrowing notice", async () => {
    await fs.promises.writeFile(
      path.join(repo, "large.txt"),
      Array.from(
        { length: 20_000 },
        (_, index) => `line-${index}-changed`,
      ).join("\n"),
    );
    await git(repo, "add", "large.txt");
    await git(repo, "commit", "-m", "large patch");

    const result = await getAgentGitCommit({
      path: repo,
      revision: "HEAD",
    });
    expect(result.truncated).toBe(true);
    expect(result.content.match(/Output truncated at 64 KiB/g)).toHaveLength(1);
  });

  it("redacts historical dotenv values and ignores replace refs", async () => {
    const initial = await git(repo, "rev-parse", "HEAD");
    await fs.promises.writeFile(path.join(repo, ".env"), "SECRET=new-value\n");
    await fs.promises.writeFile(path.join(repo, "file.txt"), "new\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "new values");
    const head = await git(repo, "rev-parse", "HEAD");
    await git(repo, "replace", head, initial);

    const dotenv = await getAgentGitFile({
      path: repo,
      revision: head,
      filePath: ".env",
    });
    expect(dotenv.content).toContain("SECRET=[redacted]");
    expect(dotenv.content).not.toContain("new-value");

    const file = await getAgentGitFile({
      path: repo,
      revision: head,
      filePath: "file.txt",
    });
    expect(file.content).toBe("new\n");
  });

  it("restores the worktree without changing the index", async () => {
    const initial = await git(repo, "rev-parse", "HEAD");
    await fs.promises.writeFile(path.join(repo, "file.txt"), "new\n");
    await git(repo, "add", "file.txt");
    await git(repo, "commit", "-m", "new file");
    await fs.promises.writeFile(path.join(repo, "file.txt"), "dirty\n");

    const indexBefore = await git(repo, "rev-parse", ":file.txt");
    await restoreAgentGitFile({
      path: repo,
      revision: initial,
      filePath: "file.txt",
    });

    await expect(
      fs.promises.readFile(path.join(repo, "file.txt"), "utf8"),
    ).resolves.toBe("base\n");
    await expect(git(repo, "rev-parse", ":file.txt")).resolves.toBe(
      indexBefore,
    );
    const status = await getAgentGitStatus({ path: repo });
    expect(status.staged).toEqual([]);
    expect(status.unstaged).toEqual(["file.txt"]);
  });

  it("recreates deleted files and overwrites untracked files", async () => {
    await fs.promises.writeFile(path.join(repo, "historical.txt"), "old\n");
    await git(repo, "add", "historical.txt");
    await git(repo, "commit", "-m", "add historical file");
    const source = await git(repo, "rev-parse", "HEAD");
    await git(repo, "rm", "historical.txt");
    await git(repo, "commit", "-m", "delete historical file");

    await restoreAgentGitFile({
      path: repo,
      revision: source,
      filePath: "historical.txt",
    });
    await expect(
      fs.promises.readFile(path.join(repo, "historical.txt"), "utf8"),
    ).resolves.toBe("old\n");

    await fs.promises.writeFile(path.join(repo, "historical.txt"), "local\n");
    await restoreAgentGitFile({
      path: repo,
      revision: source,
      filePath: "historical.txt",
    });
    await expect(
      fs.promises.readFile(path.join(repo, "historical.txt"), "utf8"),
    ).resolves.toBe("old\n");
  });

  it("restores executable and binary file content", async () => {
    const executablePath = path.join(repo, "script.sh");
    const binaryPath = path.join(repo, "asset.bin");
    await fs.promises.writeFile(executablePath, "#!/bin/sh\necho old\n", {
      mode: 0o755,
    });
    await fs.promises.chmod(executablePath, 0o755);
    await fs.promises.writeFile(binaryPath, Buffer.from([0, 1, 2, 255]));
    await git(repo, "add", "script.sh", "asset.bin");
    await git(repo, "commit", "-m", "add executable and binary");
    const source = await git(repo, "rev-parse", "HEAD");
    await fs.promises.writeFile(executablePath, "changed\n", { mode: 0o644 });
    await fs.promises.chmod(executablePath, 0o644);
    await fs.promises.writeFile(binaryPath, Buffer.from([9, 9]));

    const restoredExecutable = await restoreAgentGitFile({
      path: repo,
      revision: source,
      filePath: "script.sh",
    });
    await restoreAgentGitFile({
      path: repo,
      revision: source,
      filePath: "asset.bin",
    });

    expect(restoredExecutable.mode).toBe("100755");
    if (process.platform !== "win32") {
      expect((await fs.promises.stat(executablePath)).mode & 0o111).not.toBe(0);
    }
    await expect(fs.promises.readFile(binaryPath)).resolves.toEqual(
      Buffer.from([0, 1, 2, 255]),
    );
  });

  it.runIf(process.platform !== "win32")(
    "restores blobs without executing smudge filters",
    async () => {
      const initial = await git(repo, "rev-parse", "HEAD");
      const marker = path.join(repo, "smudge-ran");
      const filter = path.join(repo, "smudge.sh");
      await fs.promises.writeFile(filter, `#!/bin/sh\n: > '${marker}'\ncat\n`, {
        mode: 0o755,
      });
      await fs.promises.chmod(filter, 0o755);
      await fs.promises.writeFile(
        path.join(repo, ".gitattributes"),
        "file.txt filter=evil\n",
      );
      await git(repo, "add", ".gitattributes");
      await git(repo, "commit", "-m", "add filter attributes");
      await git(repo, "config", "filter.evil.smudge", filter);
      await fs.promises.writeFile(path.join(repo, "file.txt"), "dirty\n");

      await restoreAgentGitFile({
        path: repo,
        revision: initial,
        filePath: "file.txt",
      });

      await expect(fs.promises.access(marker)).rejects.toThrow();
      await expect(
        fs.promises.readFile(path.join(repo, "file.txt"), "utf8"),
      ).resolves.toBe("base\n");
    },
  );

  it("rejects binary historical reads and traversal paths", async () => {
    await fs.promises.writeFile(
      path.join(repo, "binary.dat"),
      Buffer.from([0, 1, 2]),
    );
    await git(repo, "add", "binary.dat");
    await git(repo, "commit", "-m", "binary");

    await expect(
      getAgentGitFile({
        path: repo,
        revision: "HEAD",
        filePath: "binary.dat",
      }),
    ).rejects.toThrow("Cannot display binary file");
    expect(() => normalizeAgentGitPath(repo, "../outside.txt")).toThrow(
      "Invalid Git path",
    );
    await expect(
      restoreAgentGitFile({
        path: repo,
        revision: "HEAD",
        filePath: ".",
      }),
    ).rejects.toThrow("inside the app is required");
    await expect(
      restoreAgentGitFile({
        path: repo,
        revision: "HEAD",
        filePath: "../outside.txt",
      }),
    ).rejects.toThrow("Invalid Git path");
  });

  it("rejects historical directories and submodules for restore", async () => {
    await fs.promises.mkdir(path.join(repo, "directory"));
    await fs.promises.writeFile(path.join(repo, "directory", "file.txt"), "x");
    await git(repo, "add", "directory/file.txt");
    await git(repo, "commit", "-m", "add directory");
    await expect(
      restoreAgentGitFile({
        path: repo,
        revision: "HEAD",
        filePath: "directory",
      }),
    ).rejects.toThrow("Only regular files can be restored");

    const moduleRepo = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "agent-git-module-"),
    );
    try {
      await git(moduleRepo, "init", "-b", "main");
      await git(moduleRepo, "config", "user.name", "Test User");
      await git(moduleRepo, "config", "user.email", "test@example.com");
      await fs.promises.writeFile(path.join(moduleRepo, "module.txt"), "x\n");
      await git(moduleRepo, "add", "module.txt");
      await git(moduleRepo, "commit", "-m", "module init");
      await git(
        repo,
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        moduleRepo,
        "module",
      );
      await git(repo, "commit", "-am", "add submodule");

      await expect(
        restoreAgentGitFile({
          path: repo,
          revision: "HEAD",
          filePath: "module",
        }),
      ).rejects.toThrow("Only regular files can be restored");
    } finally {
      await fs.promises.rm(moduleRepo, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")(
    "rejects historical symbolic links",
    async () => {
      await fs.promises.symlink("file.txt", path.join(repo, "linked.txt"));
      await git(repo, "add", "linked.txt");
      await git(repo, "commit", "-m", "add symlink");

      await expect(
        restoreAgentGitFile({
          path: repo,
          revision: "HEAD",
          filePath: "linked.txt",
        }),
      ).rejects.toThrow("Only regular files can be restored");
    },
  );
});
