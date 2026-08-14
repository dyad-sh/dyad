import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exec } from "dugite";
import type { BufferedProcessOptions } from "@/ipc/utils/buffered_process";
import type { AgentContext } from "./types";

const mocks = vi.hoisted(() => ({
  gitAddAll: vi.fn(),
  runBufferedProcess: vi.fn(),
}));

vi.mock("@/ipc/utils/git_utils", () => ({
  gitAddAll: mocks.gitAddAll,
}));

vi.mock("@/ipc/utils/buffered_process", () => ({
  runBufferedProcess: mocks.runBufferedProcess,
}));

import {
  isPreCommitHookAvailable,
  MAX_PRE_COMMIT_RUNS_PER_TURN,
  runPreCommitTool,
} from "./run_pre_commit";

const tempDirs: string[] = [];

async function makeRepo(options?: {
  hook?: boolean;
  executable?: boolean;
  hooksPath?: string;
}): Promise<string> {
  const repo = await mkdtemp(path.join(os.tmpdir(), "dyad-pre-commit-"));
  tempDirs.push(repo);
  const initialized = await exec(["init"], repo);
  expect(initialized.exitCode).toBe(0);

  if (options?.hooksPath) {
    const configured = await exec(
      ["config", "core.hooksPath", options.hooksPath],
      repo,
    );
    expect(configured.exitCode).toBe(0);
  }

  if (options?.hook) {
    const hookDir = options.hooksPath
      ? path.join(repo, options.hooksPath)
      : path.join(repo, ".git", "hooks");
    await mkdir(hookDir, { recursive: true });
    const hookPath = path.join(hookDir, "pre-commit");
    await writeFile(hookPath, "#!/bin/sh\nexit 0\n");
    if (process.platform !== "win32") {
      await chmod(hookPath, options.executable === false ? 0o644 : 0o755);
    }
  }

  return repo;
}

function context(appPath: string, overrides: Partial<AgentContext> = {}) {
  return {
    appPath,
    fileMutationCount: 1,
    preCommitHookAvailable: true,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    ...overrides,
  } as AgentContext;
}

function processResult(overrides = {}) {
  return {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    aborted: false,
    timedOut: false,
    ...overrides,
  };
}

describe("isPreCommitHookAvailable", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) =>
        rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        }),
      ),
    );
  });

  it("returns false when Git only resolves the default missing hook path", async () => {
    expect(await isPreCommitHookAvailable(await makeRepo())).toBe(false);
  });

  it("detects an executable hook in Git's default hooks directory", async () => {
    expect(await isPreCommitHookAvailable(await makeRepo({ hook: true }))).toBe(
      true,
    );
  });

  it("respects a configured core.hooksPath", async () => {
    const repo = await makeRepo({ hook: true, hooksPath: ".custom-hooks" });
    expect(await isPreCommitHookAvailable(repo)).toBe(true);
  });

  it.runIf(process.platform !== "win32")(
    "ignores a non-executable hook",
    async () => {
      const repo = await makeRepo({ hook: true, executable: false });
      expect(await isPreCommitHookAvailable(repo)).toBe(false);
    },
  );
});

describe("runPreCommitTool", () => {
  let repo: string;
  let hookRuns: number;
  let hookChangesFiles: boolean;
  let hookResults: ReturnType<typeof processResult>[];

  beforeEach(async () => {
    vi.clearAllMocks();
    repo = await makeRepo({ hook: true });
    hookRuns = 0;
    hookChangesFiles = false;
    hookResults = [];
    mocks.gitAddAll.mockResolvedValue(undefined);
    mocks.runBufferedProcess.mockImplementation(
      async (options: BufferedProcessOptions) => {
        if (options.args?.[0] === "hook") {
          hookRuns++;
          return hookResults.shift() ?? processResult();
        }
        options.onStdout?.(
          hookChangesFiles ? `fingerprint-${hookRuns}` : "fingerprint",
          {} as never,
        );
        return processResult();
      },
    );
  });

  it("is registered only when hook detection enabled it for the turn", () => {
    expect(
      runPreCommitTool.isEnabled?.(
        context(repo, {
          preCommitHookAvailable: true,
        }),
      ),
    ).toBe(true);
    expect(
      runPreCommitTool.isEnabled?.(
        context(repo, {
          preCommitHookAvailable: false,
        }),
      ),
    ).toBe(false);
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) =>
        rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        }),
      ),
    );
  });

  it("requires a successful file modification before staging or running", async () => {
    const ctx = context(repo, { fileMutationCount: 0 });

    const result = await runPreCommitTool.execute({}, ctx);

    expect(result).toContain("No files have been successfully modified");
    expect(mocks.gitAddAll).not.toHaveBeenCalled();
    expect(hookRuns).toBe(0);
  });

  it("stages files, returns hook errors, and refuses an unchanged retry", async () => {
    hookResults.push(processResult({ code: 1, stderr: "lint failed" }));
    const ctx = context(repo);

    const first = await runPreCommitTool.execute({}, ctx);
    const second = await runPreCommitTool.execute({}, ctx);

    expect(mocks.gitAddAll).toHaveBeenCalledWith({ path: repo });
    expect(first).toContain("lint failed");
    expect(second).toContain("no files have changed");
    expect(hookRuns).toBe(1);
  });

  it("reports a clean pass and refuses an unchanged rerun", async () => {
    hookResults.push(processResult({ stdout: "checks passed" }));
    const ctx = context(repo);

    const first = await runPreCommitTool.execute({}, ctx);
    const second = await runPreCommitTool.execute({}, ctx);

    expect(first).toContain("Pre-commit passed");
    expect(first).toContain("checks passed");
    expect(second).toContain("last pre-commit run passed");
    expect(hookRuns).toBe(1);
  });

  it("allows a retry when the hook itself changes files", async () => {
    hookChangesFiles = true;
    hookResults.push(
      processResult({ code: 1, stderr: "formatted files" }),
      processResult(),
    );
    const ctx = context(repo);

    await runPreCommitTool.execute({}, ctx);
    const second = await runPreCommitTool.execute({}, ctx);

    expect(ctx.fileMutationCount).toBe(3);
    expect(second).toContain("passed, but the hook changed files");
    expect(hookRuns).toBe(2);
  });

  it("counts timed-out runs and enforces the per-turn limit", async () => {
    hookResults.push(processResult({ code: 124, timedOut: true }));
    const ctx = context(repo, {
      preCommitRunCount: MAX_PRE_COMMIT_RUNS_PER_TURN - 1,
    });

    const timedOut = await runPreCommitTool.execute({}, ctx);
    ctx.fileMutationCount = (ctx.fileMutationCount ?? 0) + 1;
    const limited = await runPreCommitTool.execute({}, ctx);

    expect(timedOut).toContain("exceeded 10 minutes");
    expect(limited).toContain("already run 4 times");
    expect(hookRuns).toBe(1);
  });

  it("does not consume a run when the hook process cannot start", async () => {
    mocks.runBufferedProcess.mockImplementation(
      async (options: BufferedProcessOptions) => {
        if (options.args?.[0] === "hook") {
          throw new Error("spawn failed");
        }
        options.onStdout?.("fingerprint", {} as never);
        return processResult();
      },
    );
    const ctx = context(repo);

    const result = await runPreCommitTool.execute({}, ctx);

    expect(result).toContain("did not consume a run");
    expect(ctx.preCommitRunCount).toBe(0);
    expect(ctx.preCommitFileMutationCountAtLastRun).toBeUndefined();
  });
});
