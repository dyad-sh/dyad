import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exec } from "dugite";
import type { BufferedProcessOptions } from "@/ipc/utils/buffered_process";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import type { AgentContext } from "./types";

const mocks = vi.hoisted(() => ({
  cloudSync: vi.fn(),
  loggerWarn: vi.fn(),
  runBufferedProcess: vi.fn(),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: mocks.loggerWarn,
    }),
  },
}));

vi.mock("@/ipc/utils/buffered_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/buffered_process")>()),
  runBufferedProcess: mocks.runBufferedProcess,
}));

vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync: mocks.cloudSync,
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
    appId: 42,
    appPath,
    isSharedModulesChanged: false,
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    supabaseProjectId: null,
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
    mocks.runBufferedProcess.mockImplementation(
      async (options: BufferedProcessOptions) => {
        if (options.args?.[0] === "add") {
          return processResult();
        }
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
    expect(mocks.runBufferedProcess).not.toHaveBeenCalled();
    expect(hookRuns).toBe(0);
  });

  it("stages files, returns hook errors, and refuses an unchanged retry", async () => {
    hookResults.push(processResult({ code: 1, stderr: "lint failed" }));
    const ctx = context(repo);

    const first = await runPreCommitTool.execute({}, ctx);
    const second = await runPreCommitTool.execute({}, ctx);

    expect(mocks.runBufferedProcess).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["add", "--", "."], cwd: repo }),
    );
    expect(first).toContain("lint failed");
    expect(second).toContain("no files have changed");
    expect(hookRuns).toBe(1);
  });

  it("disables repository fsmonitor while fingerprinting", async () => {
    await runPreCommitTool.execute({}, context(repo));

    expect(mocks.runBufferedProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(["-c", "core.fsmonitor=false", "status"]),
      }),
    );
  });

  it("preserves the project's package-manager environment for hooks", async () => {
    vi.stubEnv("COREPACK_ENABLE_PROJECT_SPEC", "1");
    try {
      await runPreCommitTool.execute({}, context(repo));

      expect(mocks.runBufferedProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ["hook", "run", "pre-commit"],
          env: expect.objectContaining({
            COREPACK_ENABLE_PROJECT_SPEC: "1",
          }),
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("allows a follow-up run when Git fingerprinting fails", async () => {
    mocks.runBufferedProcess.mockImplementation(
      async (options: BufferedProcessOptions) => {
        if (options.args?.[0] === "hook") {
          hookRuns++;
          return processResult();
        }
        if (options.args?.[0] === "-c") {
          return processResult({ code: 1 });
        }
        options.onStdout?.("fingerprint", {} as never);
        return processResult();
      },
    );
    const ctx = context(repo);

    const first = await runPreCommitTool.execute({}, ctx);
    const second = await runPreCommitTool.execute({}, ctx);

    expect(first).toContain(
      "could not determine whether the hook changed files",
    );
    expect(second).not.toContain("no files have changed");
    expect(hookRuns).toBe(2);
    expect(mocks.loggerWarn).toHaveBeenCalled();
    expect(mocks.cloudSync).toHaveBeenCalledWith({
      appId: 42,
      fullSync: true,
    });
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
    expect(mocks.cloudSync).toHaveBeenCalledWith({
      appId: 42,
      fullSync: true,
    });
  });

  it("queues Supabase function paths changed in the hook for redeployment", async () => {
    mocks.runBufferedProcess.mockImplementation(
      async (options: BufferedProcessOptions) => {
        if (options.args?.[0] === "add") {
          return processResult();
        }
        if (options.args?.[0] === "hook") {
          hookRuns++;
          return processResult();
        }
        if (
          options.args?.includes("--name-only") ||
          options.args?.includes("ls-files")
        ) {
          options.onStdout?.(
            "supabase/functions/hello/index.ts\0supabase/functions/_shared/util.ts\0",
            {} as never,
          );
          return processResult();
        }
        options.onStdout?.(`fingerprint-${hookRuns}`, {} as never);
        return processResult();
      },
    );
    const ctx = context(repo, { supabaseProjectId: "project-id" });

    await runPreCommitTool.execute({}, ctx);

    expect(ctx.pendingFunctionDeploys).toEqual(["hello"]);
    expect(ctx.isSharedModulesChanged).toBe(true);
    expect(ctx.sharedServerModulePaths).toEqual([
      "supabase/functions/_shared/util.ts",
    ]);
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

  it("bounds staging and does not start the hook when staging times out", async () => {
    mocks.runBufferedProcess.mockImplementation(
      async (options: BufferedProcessOptions) => {
        if (options.args?.[0] === "add") {
          return processResult({ code: 124, timedOut: true });
        }
        if (options.args?.[0] === "hook") {
          hookRuns++;
        }
        return processResult();
      },
    );
    const ctx = context(repo);

    const result = await runPreCommitTool.execute({}, ctx);

    expect(result).toContain("Staging the workspace exceeded 1 minute");
    expect(ctx.preCommitRunCount).toBeUndefined();
    expect(hookRuns).toBe(0);
  });

  it("serializes the complete hook run with other repository operations", async () => {
    let releaseRepository!: () => void;
    const repositoryBlocker = appOperationCoordinator.run(
      {
        appId: 99,
        operation: "test-repository-blocker",
        resources: ["repository"],
      },
      () =>
        new Promise<void>((resolve) => {
          releaseRepository = resolve;
        }),
    );
    const pendingRun = runPreCommitTool.execute(
      {},
      context(repo, { appId: 99 }),
    );

    try {
      await Promise.resolve();
      expect(mocks.runBufferedProcess).not.toHaveBeenCalled();
    } finally {
      releaseRepository();
    }
    await repositoryBlocker;
    await pendingRun;

    expect(mocks.runBufferedProcess).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["add", "--", "."], cwd: repo }),
    );
    expect(hookRuns).toBe(1);
  });

  it("executes a real hook and permits re-verification after hook changes", async () => {
    const actualBufferedProcess = await vi.importActual<
      typeof import("@/ipc/utils/buffered_process")
    >("@/ipc/utils/buffered_process");
    mocks.runBufferedProcess.mockImplementation(
      actualBufferedProcess.runBufferedProcess,
    );
    const hookPath = path.join(repo, ".git", "hooks", "pre-commit");
    await writeFile(
      hookPath,
      "#!/bin/sh\nprintf 'hook ran\\n' >> hook-output.txt\nexit 1\n",
    );
    if (process.platform !== "win32") {
      await chmod(hookPath, 0o755);
    }
    await writeFile(path.join(repo, "source.txt"), "source\n");
    const ctx = context(repo);

    const first = await runPreCommitTool.execute({}, ctx);
    const second = await runPreCommitTool.execute({}, ctx);

    expect(first).toContain("Pre-commit failed with exit code 1");
    expect(second).not.toContain("no files have changed");
    expect(ctx.preCommitRunCount).toBe(2);
    expect(await readFile(path.join(repo, "hook-output.txt"), "utf8")).toBe(
      "hook ran\nhook ran\n",
    );
  });
});
