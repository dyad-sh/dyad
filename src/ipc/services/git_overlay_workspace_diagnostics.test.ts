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
import { logGitOverlayWorkspaceFailure } from "./git_overlay_workspace_diagnostics";

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
      expect(logsAtCleanup).toContainEqual(
        expect.objectContaining({
          stage: "overlay-working-tree",
          purpose,
          workspace: failureRecord.workspace,
        }),
      );
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
    await logGitOverlayWorkspaceFailure(failure, {
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
    await expect(
      copyGitOverlayEntriesOnWindows({
        sourceRoot,
        realSourceRoot: sourceRoot,
        workspaceRoot: scratchRoot,
        initialPaths: [sourcePath],
      }),
    ).rejects.toBe(failure);
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
    await expect(
      secureGitOverlaySymlinks(sourceRoot, scratchRoot),
    ).rejects.toThrow("target is unavailable");
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
