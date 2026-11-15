import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import {
  createGitOverlayWorkspace,
  readGitOverlayWorkspaceMarker,
  removeGitOverlayWorkspace,
} from "@/ipc/services/git_overlay_workspace";
import {
  resolvePackageManager,
  runCleanPackageInstall,
} from "@/ipc/services/isolated_package_install";
import { spawnStreaming } from "@/ipc/utils/spawn_streaming";
import { runningApps } from "@/ipc/utils/process_manager";
import { getUserDataPath } from "@/paths/paths";
import { runBuildTool } from "./run_build";
import type { AgentContext } from "./types";
import { MAX_BUILD_RUNS_PER_TURN } from "./turn_tool_budgets";

const buildLogs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock("electron-log/main", () => ({ default: { scope: () => buildLogs } }));

vi.mock("@/ipc/services/git_overlay_workspace", () => ({
  createGitOverlayWorkspace: vi.fn(),
  removeGitOverlayWorkspace: vi.fn(),
  readGitOverlayWorkspaceMarker: vi.fn(),
  isGitOverlayWorkspaceActive: vi.fn(),
}));
vi.mock("@/ipc/services/isolated_package_install", () => ({
  resolvePackageManager: vi.fn(),
  runCleanPackageInstall: vi.fn(),
  findPackageManagerRoot: vi.fn(),
  getCleanInstallArgs: vi.fn(),
}));
vi.mock("@/ipc/utils/process_manager", () => ({ runningApps: new Map() }));
vi.mock("@/ipc/utils/spawn_streaming", () => ({ spawnStreaming: vi.fn() }));
vi.mock("@/ipc/utils/socket_firewall", () => ({
  getPackageManagerCommandEnv: () => ({}),
}));
vi.mock("@/paths/paths", () => ({ getUserDataPath: vi.fn() }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const success = {
  hasLockfile: true,
  code: 0,
  stdout: "",
  stderr: "",
  aborted: false,
  timedOut: false,
};

describe("isolated production build execution", () => {
  let root: string;
  let appPath: string;
  let workspacePath: string;
  let ctx: AgentContext;

  beforeEach(async () => {
    vi.resetAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-build-execution-"));
    appPath = path.join(root, "app");
    workspacePath = path.join(root, "workspace");
    await fs.mkdir(appPath);
    await fs.writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify({ scripts: { build: "vite build" } }),
    );
    await fs.writeFile(path.join(appPath, "source.txt"), "captured edit");
    vi.mocked(getUserDataPath).mockReturnValue(root);
    vi.mocked(createGitOverlayWorkspace).mockImplementation(async () => {
      await fs.cp(appPath, workspacePath, { recursive: true });
      return {
        targetPath: workspacePath,
        worktreePath: workspacePath,
        sourceTargetPath: appPath,
        sourceRepoPath: appPath,
        setupMs: 1,
      };
    });
    vi.mocked(resolvePackageManager).mockResolvedValue({
      packageManager: "npm",
      sourceInstallPath: appPath,
    });
    vi.mocked(runCleanPackageInstall).mockResolvedValue(success);
    vi.mocked(spawnStreaming).mockResolvedValue(success);
    vi.mocked(removeGitOverlayWorkspace).mockResolvedValue(undefined);
    ctx = {
      appId: 8123,
      appPath,
      mutationCount: 1,
      onXmlComplete: vi.fn(),
      onXmlStream: vi.fn(),
    } as unknown as AgentContext;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await vi.waitFor(() =>
      expect(appOperationCoordinator.isBusy(ctx.appId, ["app-path"])).toBe(
        false,
      ),
    );
    runningApps.clear();
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([undefined, "host", "docker"])(
    "always snapshots a Vite build with preview mode %s",
    async (mode) => {
      if (mode) runningApps.set(ctx.appId, { mode } as never);
      await expect(runBuildTool.execute({}, ctx)).resolves.toContain(
        "passed for the captured snapshot",
      );
      expect(createGitOverlayWorkspace).toHaveBeenCalledOnce();
      expect(runCleanPackageInstall).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: workspacePath }),
      );
      expect(spawnStreaming).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: workspacePath, args: ["run", "build"] }),
      );
      expect(removeGitOverlayWorkspace).toHaveBeenCalledWith(
        workspacePath,
        appPath,
      );
    },
  );

  it("blocks edits during capture, then admits edits and E2E setup during install and build", async () => {
    const capture = deferred();
    const install = deferred();
    const build = deferred();
    const cleanup = deferred();
    const copyWorkspace = vi
      .mocked(createGitOverlayWorkspace)
      .getMockImplementation()!;
    vi.mocked(createGitOverlayWorkspace).mockImplementation(async (options) => {
      await capture.promise;
      return copyWorkspace(options);
    });
    vi.mocked(runCleanPackageInstall).mockImplementation(async () => {
      await install.promise;
      return success;
    });
    vi.mocked(spawnStreaming).mockImplementation(async () => {
      await build.promise;
      return success;
    });
    vi.mocked(removeGitOverlayWorkspace).mockImplementation(async () => {
      await cleanup.promise;
    });
    const execution = runBuildTool.execute({}, ctx);
    let edit: Promise<void> | undefined;
    let runtimeChange: Promise<void> | undefined;
    try {
      await vi.waitFor(() =>
        expect(createGitOverlayWorkspace).toHaveBeenCalledOnce(),
      );
      let edited = false;
      edit = appOperationCoordinator.run(
        { appId: ctx.appId, operation: "edit", resources: ["repository"] },
        async () => {
          edited = true;
          await fs.writeFile(path.join(appPath, "source.txt"), "later edit");
          await fs.writeFile(path.join(appPath, "package.json"), "{}");
        },
      );
      expect(edited).toBe(false);
      expect(
        appOperationCoordinator.isBusy(ctx.appId, ["repository-ref"]),
      ).toBe(true);
      capture.resolve();
      await vi.waitFor(() =>
        expect(runCleanPackageInstall).toHaveBeenCalledOnce(),
      );
      await edit;
      expect(edited).toBe(true);
      expect(appOperationCoordinator.isBusy(ctx.appId, ["runtime"])).toBe(true);
      const e2eSetup = vi.fn(async () => {});
      await appOperationCoordinator.run(
        {
          appId: ctx.appId,
          operation: "prepare-e2e-test-workspace",
          resources: ["repository-worktree", "test-files"],
        },
        e2eSetup,
      );
      expect(e2eSetup).toHaveBeenCalledOnce();
      expect(
        await fs.readFile(path.join(workspacePath, "source.txt"), "utf8"),
      ).toBe("captured edit");
      expect(resolvePackageManager).toHaveBeenCalledWith(appPath, appPath);
      const switchToCloud = vi.fn(async () => {
        runningApps.set(ctx.appId, { mode: "cloud" } as never);
      });
      runtimeChange = appOperationCoordinator.run(
        {
          appId: ctx.appId,
          operation: "switch-to-cloud",
          resources: ["runtime"],
        },
        switchToCloud,
      );
      expect(switchToCloud).not.toHaveBeenCalled();
      install.resolve();
      await vi.waitFor(() => expect(spawnStreaming).toHaveBeenCalledOnce());
      expect(switchToCloud).not.toHaveBeenCalled();
      expect(
        appOperationCoordinator.isBusy(ctx.appId, ["repository-worktree"]),
      ).toBe(false);
      expect(appOperationCoordinator.isBusy(ctx.appId, ["app-path"])).toBe(
        true,
      );
      await expect(runBuildTool.execute({}, { ...ctx })).resolves.toContain(
        "already running",
      );
      build.resolve();
      await vi.waitFor(() =>
        expect(removeGitOverlayWorkspace).toHaveBeenCalledOnce(),
      );
      expect(appOperationCoordinator.isBusy(ctx.appId, ["app-path"])).toBe(
        true,
      );
      await expect(execution).resolves.toContain(
        "passed for the captured snapshot",
      );
      await runtimeChange;
      expect(switchToCloud).toHaveBeenCalledOnce();
      // Tool completion and runtime changes do not wait for slow disk cleanup.
      expect(appOperationCoordinator.isBusy(ctx.appId, ["app-path"])).toBe(
        true,
      );
      cleanup.resolve();
      await vi.waitFor(() =>
        expect(appOperationCoordinator.isBusy(ctx.appId, ["app-path"])).toBe(
          false,
        ),
      );
    } finally {
      capture.resolve();
      install.resolve();
      build.resolve();
      cleanup.resolve();
      await Promise.allSettled([
        execution,
        ...(edit ? [edit] : []),
        ...(runtimeChange ? [runtimeChange] : []),
      ]);
    }
  });

  it("cancels queued admission without capturing or consuming a build", async () => {
    const hold = deferred();
    const blocker = appOperationCoordinator.run(
      {
        appId: ctx.appId,
        operation: "hold",
        resources: ["repository-worktree"],
      },
      () => hold.promise,
    );
    const controller = new AbortController();
    ctx.abortSignal = controller.signal;
    const execution = runBuildTool.execute({}, ctx);
    try {
      controller.abort();
      await expect(execution).rejects.toMatchObject({ kind: "user_cancelled" });
      expect(createGitOverlayWorkspace).not.toHaveBeenCalled();
      expect(ctx.buildAttemptState).toBeUndefined();
    } finally {
      hold.resolve();
      await blocker;
    }
    ctx.abortSignal = undefined;
    await expect(runBuildTool.execute({}, ctx)).resolves.toContain("passed");
  });

  it.each(["cancel", "timeout", "failure"])(
    "cleans the snapshot and releases claims after install %s",
    async (outcome) => {
      const controller = new AbortController();
      ctx.abortSignal = controller.signal;
      vi.mocked(runCleanPackageInstall).mockImplementation(async () => {
        if (outcome === "cancel") controller.abort();
        return {
          ...success,
          code: outcome === "failure" ? 1 : null,
          aborted: outcome === "cancel",
          timedOut: outcome === "timeout",
        };
      });
      const execution = runBuildTool.execute({}, ctx);
      if (outcome === "cancel")
        await expect(execution).rejects.toMatchObject({
          kind: "user_cancelled",
        });
      else
        await expect(execution).resolves.toContain(
          outcome === "timeout" ? "timed out" : "Could not install",
        );
      if (outcome === "failure")
        await expect(execution).resolves.toContain(
          "registry access and configured registry credentials",
        );
      expect(spawnStreaming).not.toHaveBeenCalled();
      expect(removeGitOverlayWorkspace).toHaveBeenCalledOnce();
      await vi.waitFor(() =>
        expect(appOperationCoordinator.isBusy(ctx.appId, ["app-path"])).toBe(
          false,
        ),
      );
    },
  );

  it.each(["cancel", "timeout"])(
    "settles %s before cleanup but protects the path from a queued rename",
    async (outcome) => {
      const cleanup = deferred();
      const controller = new AbortController();
      ctx.abortSignal = controller.signal;
      vi.mocked(removeGitOverlayWorkspace).mockImplementation(async () => {
        await cleanup.promise;
      });
      vi.mocked(spawnStreaming).mockImplementation(async () => {
        if (outcome === "cancel") controller.abort();
        return {
          ...success,
          code: null,
          aborted: outcome === "cancel",
          timedOut: outcome === "timeout",
        };
      });
      const execution = runBuildTool.execute({}, ctx);
      let rename: Promise<void> | undefined;
      try {
        if (outcome === "cancel")
          await expect(execution).rejects.toMatchObject({
            kind: "user_cancelled",
          });
        else await expect(execution).resolves.toContain("timed out");
        expect(removeGitOverlayWorkspace).toHaveBeenCalledOnce();
        const renameApp = vi.fn(async () => {});
        rename = appOperationCoordinator.run(
          { appId: ctx.appId, operation: "rename", resources: ["app-path"] },
          renameApp,
        );
        expect(renameApp).not.toHaveBeenCalled();
        expect(appOperationCoordinator.isBusy(ctx.appId, ["runtime"])).toBe(
          false,
        );
        cleanup.resolve();
        await rename;
        expect(renameApp).toHaveBeenCalledOnce();
      } finally {
        cleanup.resolve();
        await Promise.allSettled([execution, ...(rename ? [rename] : [])]);
      }
    },
  );

  it("allows another build after execution settles while prior cleanup continues", async () => {
    const cleanup = deferred();
    vi.mocked(removeGitOverlayWorkspace).mockImplementationOnce(async () => {
      await cleanup.promise;
    });
    try {
      await expect(runBuildTool.execute({}, ctx)).resolves.toContain("passed");
      const nextCtx = {
        ...ctx,
        buildAttemptState: { count: MAX_BUILD_RUNS_PER_TURN },
      };
      await expect(runBuildTool.execute({}, nextCtx)).resolves.toContain(
        `${MAX_BUILD_RUNS_PER_TURN}-build limit`,
      );
    } finally {
      cleanup.resolve();
    }
  });

  it("aborts the build when its shared deadline expires", async () => {
    const controller = new AbortController();
    ctx.abortSignal = controller.signal;
    vi.mocked(spawnStreaming).mockImplementation(
      async ({ signal }) =>
        new Promise((resolve) => {
          signal!.addEventListener(
            "abort",
            () => resolve({ ...success, code: null, aborted: true }),
            { once: true },
          );
        }),
    );
    vi.useFakeTimers();
    const execution = runBuildTool.execute({}, ctx);
    try {
      await vi.waitFor(() => expect(spawnStreaming).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await expect(execution).resolves.toContain("timed out after 10 minutes");
      expect(removeGitOverlayWorkspace).toHaveBeenCalledOnce();
      expect(appOperationCoordinator.isBusy(ctx.appId, ["app-path"])).toBe(
        false,
      );
    } finally {
      controller.abort();
      vi.useRealTimers();
      await Promise.allSettled([execution]);
    }
  });

  it("passes the remaining ten-minute budget and same cancellation signal to the build", async () => {
    const install = deferred();
    vi.mocked(runCleanPackageInstall).mockImplementation(async () => {
      await install.promise;
      return success;
    });
    const execution = runBuildTool.execute({}, ctx);
    try {
      await vi.waitFor(() =>
        expect(runCleanPackageInstall).toHaveBeenCalledOnce(),
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      const installArgs = vi.mocked(runCleanPackageInstall).mock.calls[0][0];
      vi.setSystemTime(Date.now() + 60_000);
      install.resolve();
      await expect(execution).resolves.toContain("passed");
      const buildArgs = vi.mocked(spawnStreaming).mock.calls[0][0];
      expect(buildArgs.signal).toBe(installArgs.signal);
      expect(buildArgs.timeoutMs).toBeLessThan(installArgs.timeoutMs! - 59_000);
    } finally {
      vi.useRealTimers();
      install.resolve();
      await Promise.allSettled([execution]);
    }
  });

  it.each(["hangs", "fails"])(
    "prepares without waiting for stale snapshot cleanup that %s",
    async (outcome) => {
      const stalePath = path.join(
        root,
        "build-snapshots",
        ".dyad-build-OLD123",
      );
      await fs.mkdir(stalePath, { recursive: true });
      const hourAndAHalfAgo = new Date(Date.now() - 90 * 60_000);
      await fs.utimes(stalePath, hourAndAHalfAgo, hourAndAHalfAgo);
      vi.mocked(readGitOverlayWorkspaceMarker).mockResolvedValue({
        schema: "dyad-git-overlay-worktree-v1",
        purpose: "build",
        sourceRepoPath: appPath,
        submoduleWorktrees: [],
      });
      const staleCleanup = deferred();
      vi.mocked(removeGitOverlayWorkspace).mockImplementation(
        async (target) => {
          if (target !== stalePath) return;
          if (outcome === "fails") throw new Error("EBUSY: resource busy");
          // Like a recursive delete of an old dependency tree on Windows: it
          // has no abort signal and can run for minutes.
          await staleCleanup.promise;
        },
      );
      const copyWorkspace = vi
        .mocked(createGitOverlayWorkspace)
        .getMockImplementation()!;
      vi.mocked(createGitOverlayWorkspace).mockImplementation(
        async (options) => {
          // Capture starts only once the stale removal is underway, so the
          // build below cannot pass by finishing before the sweep began.
          await vi.waitFor(() =>
            expect(removeGitOverlayWorkspace).toHaveBeenCalledWith(
              stalePath,
              appPath,
            ),
          );
          return copyWorkspace(options);
        },
      );
      try {
        await expect(runBuildTool.execute({}, ctx)).resolves.toContain(
          "passed for the captured snapshot",
        );
        await vi.waitFor(() =>
          expect(appOperationCoordinator.isBusy(ctx.appId, ["app-path"])).toBe(
            false,
          ),
        );
      } finally {
        staleCleanup.resolve();
      }
    },
  );

  it.each(["worktree creation", "package manager resolution"] as const)(
    "releases coordinator ownership and the build slot during a stuck %s",
    async (step) => {
      const stuck = deferred();
      const cleanup = deferred();
      vi.mocked(removeGitOverlayWorkspace).mockImplementation(
        () => cleanup.promise,
      );
      const copyWorkspace = vi
        .mocked(createGitOverlayWorkspace)
        .getMockImplementation()!;
      // Neither mock observes the abort signal, like a filesystem call or
      // package-manager probe that cannot be interrupted.
      if (step === "worktree creation") {
        vi.mocked(createGitOverlayWorkspace).mockImplementation(
          async (options) => {
            await stuck.promise;
            return copyWorkspace(options);
          },
        );
      } else {
        vi.mocked(resolvePackageManager).mockImplementation(async () => {
          await stuck.promise;
          return { packageManager: "npm", sourceInstallPath: appPath };
        });
      }
      const controller = new AbortController();
      ctx.abortSignal = controller.signal;
      const execution = runBuildTool.execute({}, ctx);
      let edit: Promise<void> | undefined;
      try {
        await vi.waitFor(() =>
          expect(
            step === "worktree creation"
              ? createGitOverlayWorkspace
              : resolvePackageManager,
          ).toHaveBeenCalledOnce(),
        );
        let edited = false;
        edit = appOperationCoordinator.run(
          { appId: ctx.appId, operation: "edit", resources: ["repository"] },
          async () => {
            edited = true;
          },
        );
        expect(edited).toBe(false);
        controller.abort();
        await expect(execution).rejects.toMatchObject({
          kind: "user_cancelled",
        });
        expect(
          ctx.buildAttemptState?.mutationCountAtLastSetupFailure,
        ).toBeUndefined();

        // Later edits, runtime changes, rename and deletion must proceed even
        // while preparation is still stuck.
        await edit;
        expect(edited).toBe(true);
        await appOperationCoordinator.run(
          {
            appId: ctx.appId,
            operation: "rename and restart",
            resources: ["app-path", "runtime"],
          },
          async () => {},
        );
        const deletion = appOperationCoordinator.beginAppDeletion(ctx.appId);
        try {
          await deletion.drain();
          const deleted = vi.fn();
          await deletion.runExclusive(deleted);
          expect(deleted).toHaveBeenCalledOnce();
        } finally {
          deletion.release();
        }
        expect(buildLogs.info).toHaveBeenCalledWith(
          expect.stringContaining(
            "tool result settled; underlying preparation still outstanding",
          ),
        );
        expect(buildLogs.info).not.toHaveBeenCalledWith(
          expect.stringContaining("outstanding preparation settled after"),
        );
        expect(buildLogs.info).toHaveBeenCalledWith(
          expect.stringContaining("build slot released"),
        );

        stuck.resolve();
        // A snapshot created after cancellation is still cleaned up, and
        // nothing after the abandoned step runs.
        await vi.waitFor(() =>
          expect(removeGitOverlayWorkspace).toHaveBeenCalledWith(
            workspacePath,
            appPath,
          ),
        );
        if (step === "worktree creation") {
          expect(resolvePackageManager).not.toHaveBeenCalled();
        }
        expect(runCleanPackageInstall).not.toHaveBeenCalled();
        await appOperationCoordinator.run(
          { appId: ctx.appId, operation: "rename", resources: ["app-path"] },
          async () => {},
        );
        expect(buildLogs.info).not.toHaveBeenCalledWith(
          expect.stringContaining("abandoned snapshot cleanup settled"),
        );
        cleanup.resolve();
        await vi.waitFor(() =>
          expect(buildLogs.info).toHaveBeenCalledWith(
            expect.stringContaining("abandoned snapshot cleanup settled"),
          ),
        );
        const lifecycle = buildLogs.info.mock.calls
          .map(([message]) => message)
          .filter((message: string) => message.startsWith("Production build "));
        expect(lifecycle).toEqual([
          expect.stringContaining("build slot released"),
          expect.stringContaining(
            "tool result settled; underlying preparation still outstanding",
          ),
          expect.stringContaining("outstanding preparation settled after"),
          expect.stringContaining("abandoned snapshot cleanup settled"),
        ]);
      } finally {
        stuck.resolve();
        cleanup.resolve();
        await Promise.allSettled([execution, ...(edit ? [edit] : [])]);
      }

      vi.mocked(resolvePackageManager).mockResolvedValue({
        packageManager: "npm",
        sourceInstallPath: appPath,
      });
      ctx.abortSignal = undefined;
      await expect(runBuildTool.execute({}, ctx)).resolves.toContain(
        "passed for the captured snapshot",
      );
    },
  );

  it.each(["worktree creation", "package manager resolution"] as const)(
    "allows a new build while abandoned %s is stuck and preserves the new build's slot when old work settles",
    async (step) => {
      const stuck = deferred();
      const nextInstallStarted = deferred();
      const finishNextInstall = deferred();
      if (step === "worktree creation") {
        const copyWorkspace = vi
          .mocked(createGitOverlayWorkspace)
          .getMockImplementation()!;
        vi.mocked(createGitOverlayWorkspace).mockImplementationOnce(
          async (options) => {
            await stuck.promise;
            return copyWorkspace(options);
          },
        );
      } else {
        vi.mocked(resolvePackageManager).mockImplementationOnce(async () => {
          await stuck.promise;
          return { packageManager: "npm", sourceInstallPath: appPath };
        });
      }
      const controller = new AbortController();
      ctx.abortSignal = controller.signal;
      const execution = runBuildTool.execute({}, ctx);
      let nextBuild: Promise<string> | undefined;
      try {
        await vi.waitFor(() =>
          expect(
            step === "worktree creation"
              ? createGitOverlayWorkspace
              : resolvePackageManager,
          ).toHaveBeenCalledOnce(),
        );
        controller.abort();
        await expect(execution).rejects.toMatchObject({
          kind: "user_cancelled",
        });
        const nextWorkspacePath = path.join(root, "next-workspace");
        vi.mocked(createGitOverlayWorkspace).mockResolvedValueOnce({
          targetPath: nextWorkspacePath,
          worktreePath: nextWorkspacePath,
          sourceTargetPath: appPath,
          sourceRepoPath: appPath,
          setupMs: 1,
        });
        vi.mocked(runCleanPackageInstall).mockImplementationOnce(async () => {
          nextInstallStarted.resolve();
          await finishNextInstall.promise;
          return success;
        });
        const nextCtx = {
          ...ctx,
          abortSignal: undefined,
          buildAttemptState: undefined,
        };
        nextBuild = runBuildTool.execute({}, nextCtx);
        await nextInstallStarted.promise;
        expect(buildLogs.info).not.toHaveBeenCalledWith(
          expect.stringContaining("outstanding preparation settled after"),
        );

        stuck.resolve();
        await vi.waitFor(() =>
          expect(buildLogs.info).toHaveBeenCalledWith(
            expect.stringContaining("abandoned snapshot cleanup settled"),
          ),
        );
        expect(removeGitOverlayWorkspace).toHaveBeenCalledWith(
          workspacePath,
          appPath,
        );
        expect(removeGitOverlayWorkspace).not.toHaveBeenCalledWith(
          nextWorkspacePath,
          appPath,
        );
        expect(runCleanPackageInstall).toHaveBeenCalledOnce();
        await expect(runBuildTool.execute({}, nextCtx)).resolves.toContain(
          "A production build is already running",
        );

        finishNextInstall.resolve();
        await expect(nextBuild).resolves.toContain(
          "passed for the captured snapshot",
        );
        expect(removeGitOverlayWorkspace).toHaveBeenCalledWith(
          nextWorkspacePath,
          appPath,
        );
      } finally {
        stuck.resolve();
        finishNextInstall.resolve();
        await Promise.allSettled([
          execution,
          ...(nextBuild ? [nextBuild] : []),
        ]);
      }
    },
  );

  it("reports the deadline and releases coordinator ownership and the build slot before preparation settles", async () => {
    const stuck = deferred();
    const copyWorkspace = vi
      .mocked(createGitOverlayWorkspace)
      .getMockImplementation()!;
    vi.mocked(createGitOverlayWorkspace).mockImplementation(async (options) => {
      await stuck.promise;
      return copyWorkspace(options);
    });
    vi.useFakeTimers();
    const execution = runBuildTool.execute({}, ctx);
    try {
      await vi.waitFor(() =>
        expect(createGitOverlayWorkspace).toHaveBeenCalledOnce(),
      );
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await expect(execution).resolves.toContain(
        "timed out after 10 minutes during snapshot setup (worktree creation)",
      );
      // Unlike cancellation, a timed-out setup is not retried unchanged.
      expect(ctx.buildAttemptState?.mutationCountAtLastSetupFailure).toBe(1);
      await appOperationCoordinator.run(
        {
          appId: ctx.appId,
          operation: "edit after deadline",
          resources: ["repository", "app-path", "runtime"],
        },
        async () => {},
      );
      const deletion = appOperationCoordinator.beginAppDeletion(ctx.appId);
      try {
        await deletion.drain();
        await deletion.runExclusive(async () => {});
      } finally {
        deletion.release();
      }
      await expect(
        runBuildTool.execute({}, { ...ctx, abortSignal: undefined }),
      ).resolves.toContain("Isolated build setup already failed");
      stuck.resolve();
      await vi.waitFor(() =>
        expect(removeGitOverlayWorkspace).toHaveBeenCalledWith(
          workspacePath,
          appPath,
        ),
      );
      await vi.waitFor(() =>
        expect(appOperationCoordinator.isBusy(ctx.appId, ["app-path"])).toBe(
          false,
        ),
      );
    } finally {
      stuck.resolve();
      vi.useRealTimers();
      await Promise.allSettled([execution]);
    }
    expect(spawnStreaming).not.toHaveBeenCalled();
  });

  it.each(["worktree creation", "package manager resolution"] as const)(
    "handles abandoned %s rejecting after the app is deleted",
    async (step) => {
      const stuck = deferred();
      const rejectAfterDeletion = async () => {
        await stuck.promise;
        throw Object.assign(new Error("Source app was deleted"), {
          code: "ENOENT",
        });
      };
      if (step === "worktree creation") {
        vi.mocked(createGitOverlayWorkspace).mockImplementationOnce(
          rejectAfterDeletion,
        );
      } else {
        vi.mocked(resolvePackageManager).mockImplementationOnce(
          rejectAfterDeletion,
        );
      }
      const controller = new AbortController();
      ctx.abortSignal = controller.signal;
      const execution = runBuildTool.execute({}, ctx);
      try {
        await vi.waitFor(() =>
          expect(
            step === "worktree creation"
              ? createGitOverlayWorkspace
              : resolvePackageManager,
          ).toHaveBeenCalledOnce(),
        );
        controller.abort();
        await expect(execution).rejects.toMatchObject({
          kind: "user_cancelled",
        });
        const deletion = appOperationCoordinator.beginAppDeletion(ctx.appId);
        try {
          await deletion.drain();
          await deletion.runExclusive(() =>
            fs.rm(appPath, { recursive: true, force: true }),
          );
        } finally {
          deletion.release();
        }
        stuck.resolve();
        await vi.waitFor(() =>
          expect(buildLogs.info).toHaveBeenCalledWith(
            expect.stringContaining("abandoned snapshot cleanup settled"),
          ),
        );
        expect(runCleanPackageInstall).not.toHaveBeenCalled();
        expect(spawnStreaming).not.toHaveBeenCalled();
        expect(removeGitOverlayWorkspace).toHaveBeenCalledTimes(
          step === "worktree creation" ? 0 : 1,
        );

        // The abandoned rejection must not leave this app's build slot occupied.
        await fs.mkdir(appPath);
        await fs.writeFile(
          path.join(appPath, "package.json"),
          JSON.stringify({ scripts: { build: "vite build" } }),
        );
        ctx.abortSignal = undefined;
        await expect(runBuildTool.execute({}, ctx)).resolves.toContain(
          "passed",
        );
      } finally {
        stuck.resolve();
        await Promise.allSettled([execution]);
      }
    },
  );

  it("keeps later builds working when snapshot cleanup fails", async () => {
    vi.mocked(removeGitOverlayWorkspace).mockRejectedValueOnce(
      new Error("EBUSY: resource busy or locked"),
    );
    await expect(runBuildTool.execute({}, ctx)).resolves.toContain("passed");
    await vi.waitFor(() =>
      expect(appOperationCoordinator.isBusy(ctx.appId, ["app-path"])).toBe(
        false,
      ),
    );
    await expect(
      runBuildTool.execute({}, { ...ctx, buildAttemptState: undefined }),
    ).resolves.toContain("passed");
    expect(removeGitOverlayWorkspace).toHaveBeenCalledTimes(2);
  });
});
