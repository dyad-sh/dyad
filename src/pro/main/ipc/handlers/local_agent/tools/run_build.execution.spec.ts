import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import {
  createGitOverlayWorkspace,
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

vi.mock("@/ipc/services/git_overlay_workspace", () => ({
  createGitOverlayWorkspace: vi.fn(),
  removeGitOverlayWorkspace: vi.fn(),
  readGitOverlayWorkspaceMarker: vi.fn(),
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
      const nextCtx = { ...ctx, buildAttemptState: { count: 3 } };
      await expect(runBuildTool.execute({}, nextCtx)).resolves.toContain(
        "3-build limit",
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
});
