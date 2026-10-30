import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { runBufferedProcess } from "@/ipc/utils/buffered_process";
import {
  copyGitOverlayEntriesOnWindows,
  createGitOverlayWorkspace,
  isGitOverlayWorkspaceActive,
  removeGitOverlayWorkspace,
  secureGitOverlaySymlinks,
} from "./git_overlay_workspace";
import { createGitOverlayWorkspaceDiagnostics } from "./git_overlay_workspace_diagnostics";

const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock("electron-log/main", () => ({ default: { scope: () => logger } }));
vi.mock("@/ipc/utils/git_utils", () => ({
  getGitProcessEnvironment: () => ({ gitLocation: "git", env: {} }),
}));
vi.mock("@/ipc/utils/buffered_process", () => ({
  runBufferedProcess: vi.fn(),
}));

const originalPlatform = process.platform;
const roots: string[] = [];
const prefix = "Workspace preparation failed: ";

function records() {
  return logger.error.mock.calls.map(([line]) => {
    expect(line).toMatch(/^Workspace preparation failed: /);
    // The debug-session exporter reads lines from the file transport. Embedded
    // stacks must stay JSON-escaped so a log-tail cut cannot split the record.
    expect(line).not.toContain("\n");
    return JSON.parse(line.slice(prefix.length));
  });
}

async function fixture() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "dyad-workspace-diagnostics-")),
  );
  roots.push(root);
  const sourceRoot = path.join(root, "source");
  const scratchRoot = path.join(root, "scratch");
  await fs.mkdir(sourceRoot);
  return { root, sourceRoot, scratchRoot };
}

function mockGit(sourceRoot: string, status = "", onCleanup = () => {}) {
  vi.mocked(runBufferedProcess).mockImplementation(async ({ args = [] }) => {
    let stdout = "";
    if (args.includes("rev-parse")) stdout = `${sourceRoot}\n`;
    if (args.includes("status")) stdout = status;
    if (args.includes("worktree") && args.includes("remove")) {
      onCleanup();
      await fs.rm(args.at(-1)!, { recursive: true, force: true });
    }
    return {
      code: 0,
      signal: null,
      stdout,
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      aborted: false,
      timedOut: false,
    };
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(async () => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  vi.restoreAllMocks();
  logger.error.mockReset();
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("workspace preparation failure logs", () => {
  it.each(["build", "e2e-test"] as const)(
    "logs the failing concurrent Windows copy before %s cleanup, even without OS paths",
    async (purpose) => {
      const { sourceRoot, scratchRoot } = await fixture();
      const generated = path.join(sourceRoot, ".dyad");
      await fs.mkdir(generated);
      const badPath = path.join(generated, "bad.txt");
      await fs.writeFile(badPath, "do not log file contents");
      await fs.writeFile(path.join(generated, "sibling.txt"), "sibling");
      Object.defineProperty(process, "platform", { value: "win32" });

      let logsAtCleanup: ReturnType<typeof records> = [];
      mockGit(sourceRoot, "?? .dyad/\0", () => {
        logsAtCleanup = records();
      });
      // Deliberately omit syscall/path/dest, like the reported Windows error.
      const failure = Object.assign(new Error("ENOTDIR, not a directory"), {
        code: "ENOTDIR",
      });
      let releaseFailure!: () => void;
      const siblingCopied = new Promise<void>((resolve) => {
        releaseFailure = resolve;
      });
      const copyFile = fs.copyFile.bind(fs);
      vi.spyOn(fs, "copyFile").mockImplementation(
        async (source, dest, mode) => {
          if (source === badPath) {
            await siblingCopied;
            throw failure;
          }
          await copyFile(source, dest, mode);
          releaseFailure();
        },
      );

      await expect(
        createGitOverlayWorkspace({
          sourceTargetPath: sourceRoot,
          scratchRoot,
          directoryPrefix: "run-",
          purpose,
          excludedTargetRootNames: new Set(),
          cleanupFailureMode: purpose === "build" ? "background" : "await",
        }),
      ).rejects.toThrow(
        "Could not prepare the isolated Git workspace: ENOTDIR, not a directory",
      );
      await vi.waitFor(() => expect(logsAtCleanup.length).toBeGreaterThan(0));
      const failureRecord = logsAtCleanup.find(
        (record) => record.stage === "windows-copy-entry",
      );
      expect(failureRecord).toMatchObject({
        operation: "copyFile",
        error: {
          code: "ENOTDIR",
          message: failure.message,
          stack: expect.any(String),
        },
        paths: {
          source: {
            entry: { path: "<repo>/.dyad/bad.txt", type: "file" },
            parent: { path: "<repo>/.dyad", type: "directory" },
          },
          destination: {
            entry: { path: "<workspace>/.dyad/bad.txt", type: "missing" },
            parent: { path: "<workspace>/.dyad", type: "directory" },
          },
        },
      });
      expect(logsAtCleanup).toHaveLength(2);
      expect(logsAtCleanup[1]).toEqual({
        timestamp: expect.any(String),
        stage: "overlay-working-tree",
        purpose,
        workspace: failureRecord.workspace,
        detailedFailures: 1,
        suppressedFailures: 0,
      });
      const worktreePath = path.join(scratchRoot, failureRecord.workspace);
      await vi.waitFor(() =>
        expect(isGitOverlayWorkspaceActive(worktreePath)).toBe(false),
      );
      await expect(fs.lstat(worktreePath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(JSON.stringify(logsAtCleanup)).not.toContain(
        JSON.stringify(sourceRoot).slice(1, -1),
      );
      expect(JSON.stringify(logsAtCleanup)).not.toContain(
        "do not log file contents",
      );
    },
  );

  it("bounds concurrent directory failures separately for each workspace preparation", async () => {
    const { sourceRoot, scratchRoot } = await fixture();
    for (const directory of ["first", "second"]) {
      const sourceDirectory = path.join(sourceRoot, directory);
      await fs.mkdir(sourceDirectory);
      await Promise.all(
        Array.from({ length: 32 }, (_, index) =>
          fs.writeFile(path.join(sourceDirectory, `${index}.txt`), "contents"),
        ),
      );
    }
    Object.defineProperty(process, "platform", { value: "win32" });
    mockGit(sourceRoot, "?? first/\0?? second/\0");
    const copyFile = vi.spyOn(fs, "copyFile").mockImplementation(async () => {
      // Distinct errors bypass identity deduplication: the preparation's shared
      // budget must bound records across both concurrent directory batches.
      throw Object.assign(new Error("No space left on device"), {
        code: "ENOSPC",
      });
    });

    const outcomes = await Promise.allSettled(
      (["build", "e2e-test"] as const).map((purpose) =>
        createGitOverlayWorkspace({
          sourceTargetPath: sourceRoot,
          scratchRoot,
          directoryPrefix: "run-",
          purpose,
          excludedTargetRootNames: new Set(),
        }),
      ),
    );
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({
        status: "rejected",
        reason: { message: expect.stringContaining("No space left on device") },
      });
    }
    expect(copyFile).toHaveBeenCalledTimes(128);
    const allRecords = records();
    expect(allRecords).toHaveLength(8);
    const summaries = allRecords.filter(
      (record) => record.stage === "overlay-working-tree",
    );
    expect(summaries.map((record) => record.purpose).sort()).toEqual([
      "build",
      "e2e-test",
    ]);
    for (const summary of summaries) {
      expect(summary).toEqual({
        timestamp: expect.any(String),
        stage: "overlay-working-tree",
        purpose: expect.any(String),
        workspace: expect.any(String),
        detailedFailures: 3,
        suppressedFailures: 61,
      });
      const workspaceRecords = allRecords.filter(
        (record) => record.workspace === summary.workspace,
      );
      expect(workspaceRecords).toHaveLength(4);
      expect(workspaceRecords.at(-1)).toBe(summary);
      for (const detail of workspaceRecords.slice(0, -1)) {
        expect(detail).toMatchObject({
          stage: "windows-copy-entry",
          operation: "copyFile",
          error: { code: "ENOSPC" },
          paths: { source: { entry: { type: "file" } } },
        });
      }
      const worktreePath = path.join(scratchRoot, summary.workspace);
      expect(isGitOverlayWorkspaceActive(worktreePath)).toBe(false);
      await expect(fs.lstat(worktreePath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  });

  it.each([new Error("copy failed"), "copy failed"])(
    "skips probes for repeated and suppressed failures (%s)",
    async (failure) => {
      const { sourceRoot, scratchRoot } = await fixture();
      const sourcePath = path.join(sourceRoot, "source.txt");
      await fs.writeFile(sourcePath, "contents");
      await fs.mkdir(scratchRoot);
      const context = {
        stage: "windows-copy-entry",
        operation: "copyFile",
        sourceRoot,
        workspaceRoot: scratchRoot,
        sourcePath,
        destinationPath: path.join(scratchRoot, "source.txt"),
      };
      const lstat = vi.spyOn(fs, "lstat");
      const diagnostics = createGitOverlayWorkspaceDiagnostics();
      await Promise.all([
        diagnostics.logFailure(failure, context),
        diagnostics.logFailure(failure, context),
      ]);
      await diagnostics.logFailure(failure, {
        ...context,
        stage: "overlay-path",
      });
      expect(records()).toHaveLength(1);
      expect(lstat).toHaveBeenCalledTimes(4);

      await Promise.all(
        Array.from({ length: 32 }, () =>
          diagnostics.logFailure(new Error("another copy failed"), context),
        ),
      );
      await diagnostics.logPreparationFailure(failure, {
        ...context,
        stage: "overlay-working-tree",
        purpose: "build",
      });
      expect(records()).toHaveLength(4);
      expect(records().at(-1)).toMatchObject({
        detailedFailures: 3,
        suppressedFailures: 30,
      });
      // Only three detailed records inspect the source, destination and parents.
      expect(lstat).toHaveBeenCalledTimes(12);
    },
  );

  it("records a scratch path's non-directory parent before a workspace exists", async () => {
    const { sourceRoot, scratchRoot } = await fixture();
    await fs.writeFile(scratchRoot, "file blocking the scratch directory");
    await expect(
      createGitOverlayWorkspace({
        sourceTargetPath: sourceRoot,
        scratchRoot: path.join(scratchRoot, "runs"),
        directoryPrefix: "run-",
        purpose: "build",
        excludedTargetRootNames: new Set(),
      }),
    ).rejects.toThrow("Could not prepare the isolated Git workspace");
    expect(records()).toEqual([
      expect.objectContaining({
        stage: "create-scratch-root",
        purpose: "build",
        paths: expect.objectContaining({
          destination: {
            entry: expect.objectContaining({
              path: "<scratch>",
            }),
            parent: expect.objectContaining({ type: "file" }),
          },
        }),
      }),
    ]);
    expect(runBufferedProcess).not.toHaveBeenCalled();
  });

  it("logs an overlay removal failure before cleanup, even when Git cleanup also fails", async () => {
    const { sourceRoot, scratchRoot } = await fixture();
    await fs.mkdir(path.join(sourceRoot, ".dyad"));
    const cleanupFailure = new Error("Git cleanup failed");
    let logsAtCleanup: ReturnType<typeof records> = [];
    mockGit(sourceRoot, "?? .dyad/\0", () => {
      logsAtCleanup = records();
      throw cleanupFailure;
    });
    const failure = Object.assign(new Error("ENOTDIR, not a directory"), {
      code: "ENOTDIR",
    });
    const rm = fs.rm.bind(fs);
    vi.spyOn(fs, "rm").mockImplementation(async (entry, options) => {
      if (path.basename(String(entry)) === ".dyad") throw failure;
      await rm(entry, options);
    });
    await expect(
      createGitOverlayWorkspace({
        sourceTargetPath: sourceRoot,
        scratchRoot,
        directoryPrefix: "run-",
        purpose: "e2e-test",
        excludedTargetRootNames: new Set(),
      }),
    ).rejects.toThrow("ENOTDIR, not a directory");
    expect(logsAtCleanup).toContainEqual(
      expect.objectContaining({
        stage: "overlay-path",
        operation: "rm",
        error: expect.objectContaining({ code: "ENOTDIR" }),
        paths: expect.objectContaining({
          source: expect.objectContaining({
            entry: { path: "<repo>/.dyad", type: "directory" },
          }),
        }),
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to unregister worktree"),
      cleanupFailure,
    );
    const worktreePath = path.join(scratchRoot, logsAtCleanup[0].workspace);
    await expect(fs.lstat(worktreePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps errno paths, syscall and parent types when a diagnostic probe fails", async () => {
    const { sourceRoot, scratchRoot } = await fixture();
    const sourcePath = path.join(sourceRoot, "source.txt");
    await fs.writeFile(sourcePath, "contents");
    await fs.mkdir(scratchRoot);
    const blockedParent = path.join(scratchRoot, "blocked");
    await fs.writeFile(blockedParent, "file");
    const destinationPath = path.join(blockedParent, "target.txt");
    const failure = Object.assign(
      new Error(`Cannot copy ${sourcePath} to ${destinationPath}`),
      {
        code: "ENOTDIR",
        syscall: "copyfile",
        path: sourcePath,
        dest: destinationPath,
      },
    );
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation(((entry: string) => {
      if (entry === sourcePath)
        return Promise.reject(
          Object.assign(new Error("probe denied"), { code: "EACCES" }),
        );
      return lstat(entry);
    }) as typeof fs.lstat);
    // Call the logger directly here: the failed lstat is a diagnostic probe,
    // rather than the copy operation that already failed.
    await createGitOverlayWorkspaceDiagnostics().logFailure(failure, {
      stage: "windows-copy-entry",
      operation: "copyFile",
      sourceRoot,
      workspaceRoot: scratchRoot,
      sourcePath,
      destinationPath,
    });
    expect(records()[0]).toMatchObject({
      error: {
        code: "ENOTDIR",
        syscall: "copyfile",
        message: `Cannot copy <repo>${path.sep}source.txt to <workspace>${path.sep}blocked${path.sep}target.txt`,
      },
      paths: {
        errorPath: {
          entry: {
            path: "<repo>/source.txt",
            type: "unavailable",
            errorCode: "EACCES",
          },
        },
        errorDestination: {
          parent: { path: "<workspace>/blocked", type: "file" },
        },
      },
    });
  });

  it("does not let a broken log transport replace a copy failure", async () => {
    const { sourceRoot, scratchRoot } = await fixture();
    await fs.mkdir(scratchRoot);
    const sourcePath = path.join(sourceRoot, "file.txt");
    await fs.writeFile(sourcePath, "contents");
    const failure = Object.assign(new Error("copy failed"), { code: "EIO" });
    vi.spyOn(fs, "copyFile").mockRejectedValue(failure);
    logger.error.mockImplementation(() => {
      throw new Error("log unavailable");
    });
    const diagnostics = createGitOverlayWorkspaceDiagnostics();
    await expect(
      copyGitOverlayEntriesOnWindows({
        sourceRoot,
        realSourceRoot: sourceRoot,
        workspaceRoot: scratchRoot,
        initialPaths: [sourcePath],
        diagnostics,
      }),
    ).rejects.toBe(failure);
    await expect(
      diagnostics.logPreparationFailure(failure, {
        stage: "overlay-working-tree",
        purpose: "build",
        sourceRoot,
        workspaceRoot: scratchRoot,
      }),
    ).resolves.toBeUndefined();
  });

  it("records a link's original resolution error before it is wrapped", async () => {
    const { sourceRoot, scratchRoot } = await fixture();
    await fs.mkdir(scratchRoot);
    const target = path.join(scratchRoot, "target");
    await fs.mkdir(target);
    const link = path.join(scratchRoot, "link");
    // Junctions work without Developer Mode on Windows.
    await fs.symlink(target, link, "junction");
    const realpath = fs.realpath.bind(fs);
    vi.spyOn(fs, "realpath").mockImplementation(((entry: string) => {
      if (entry === link)
        return Promise.reject(
          Object.assign(new Error("broken link"), { code: "ENOTDIR" }),
        );
      return realpath(entry);
    }) as typeof fs.realpath);
    const diagnostics = createGitOverlayWorkspaceDiagnostics();
    const wrappedError = await secureGitOverlaySymlinks(
      sourceRoot,
      scratchRoot,
      undefined,
      diagnostics,
    ).catch((error: unknown) => error);
    expect(wrappedError).toMatchObject({
      message: expect.stringContaining("target is unavailable"),
    });
    const lstat = vi.spyOn(fs, "lstat");
    const readlink = vi.spyOn(fs, "readlink");
    await diagnostics.logPreparationFailure(wrappedError, {
      stage: "secure-symlinks",
      purpose: "e2e-test",
      sourceRoot,
      workspaceRoot: scratchRoot,
      destinationPath: scratchRoot,
    });
    expect(lstat).not.toHaveBeenCalled();
    expect(readlink).not.toHaveBeenCalled();
    expect(records()).toHaveLength(2);
    expect(records()[0]).toMatchObject({
      stage: "secure-symlinks",
      operation: "realpath",
      error: { code: "ENOTDIR", message: "broken link" },
      paths: {
        destination: {
          entry: { type: "symlink", linkTarget: "<workspace>/target" },
        },
      },
    });
    expect(records()[1]).toEqual({
      timestamp: expect.any(String),
      stage: "secure-symlinks",
      purpose: "e2e-test",
      workspace: path.basename(scratchRoot),
      detailedFailures: 1,
      suppressedFailures: 0,
    });
  });

  it("does not log successful preparation or user cancellation as failures", async () => {
    const { sourceRoot, scratchRoot } = await fixture();
    mockGit(sourceRoot);
    const workspace = await createGitOverlayWorkspace({
      sourceTargetPath: sourceRoot,
      scratchRoot,
      directoryPrefix: "run-",
      purpose: "build",
      excludedTargetRootNames: new Set(),
    });
    await removeGitOverlayWorkspace(workspace.worktreePath, sourceRoot);
    vi.mocked(runBufferedProcess).mockRejectedValueOnce(
      new DyadError("Cancelled", DyadErrorKind.UserCancelled),
    );
    await expect(
      createGitOverlayWorkspace({
        sourceTargetPath: sourceRoot,
        scratchRoot,
        directoryPrefix: "run-",
        purpose: "build",
        excludedTargetRootNames: new Set(),
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.UserCancelled });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
