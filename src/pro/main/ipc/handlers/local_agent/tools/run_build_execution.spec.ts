import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runningApps } from "@/ipc/utils/process_manager";
import type { AgentContext } from "./types";

vi.mock("@/ipc/services/app_operation_coordinator", () => ({
  appOperationCoordinator: {
    run: vi.fn(async (_options: unknown, operation: () => Promise<unknown>) =>
      operation(),
    ),
  },
  readAppResource: vi.fn((resource: string) => ({ resource, mode: "read" })),
}));

vi.mock("@/ipc/services/docker_runtime/runtime_mode", () => ({
  isDockerRuntimeActive: vi.fn(() => false),
}));

vi.mock("@/ipc/services/docker_runtime/guest_command", () => ({
  appGuestInput: vi.fn(async (input: object) => ({ kind: "app", ...input })),
  snapshotGuestInput: vi.fn(async (input: object) => ({
    kind: "snapshot",
    ...input,
  })),
  runGuestStreaming: vi.fn(),
}));

vi.mock("@/ipc/utils/spawn_streaming", () => ({
  spawnStreaming: vi.fn(),
}));

vi.mock("@/ipc/utils/socket_firewall", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/socket_firewall")>()),
  getPnpmMinimumReleaseAgeSupport: vi.fn(async () => ({
    available: false,
    minimumReleaseAgeSupported: false,
  })),
}));

vi.mock("@/ipc/services/git_overlay_workspace", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/ipc/services/git_overlay_workspace")
  >()),
  createGitOverlayWorkspace: vi.fn(),
  removeGitOverlayWorkspace: vi.fn(async () => {}),
}));

vi.mock("@/paths/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/paths/paths")>()),
  getUserDataPath: vi.fn(),
}));

import {
  appGuestInput,
  runGuestStreaming,
  snapshotGuestInput,
} from "@/ipc/services/docker_runtime/guest_command";
import { isDockerRuntimeActive } from "@/ipc/services/docker_runtime/runtime_mode";
import { createGitOverlayWorkspace } from "@/ipc/services/git_overlay_workspace";
import { getPnpmMinimumReleaseAgeSupport } from "@/ipc/utils/socket_firewall";
import { spawnStreaming } from "@/ipc/utils/spawn_streaming";
import { getUserDataPath } from "@/paths/paths";
import { runBuildTool } from "./run_build";

const passed = {
  code: 0,
  stdout: "ok",
  stderr: "",
  aborted: false,
  timedOut: false,
};

describe("run_build execution", () => {
  let root: string;
  let appPath: string;

  function makeCtx(appId: number): AgentContext {
    return {
      appId,
      appPath,
      mutationCount: 1,
      onXmlComplete: vi.fn(),
      onXmlStream: vi.fn(),
    } as unknown as AgentContext;
  }

  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "dyad-build-exec-")),
    );
    appPath = path.join(root, "app");
    await fs.mkdir(appPath);
    await fs.writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify({
        scripts: { build: "vite build", postbuild: "node post.js" },
      }),
    );
    await fs.writeFile(path.join(appPath, "pnpm-lock.yaml"), "");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "userData"));
    vi.mocked(runGuestStreaming).mockResolvedValue(passed);
    vi.mocked(spawnStreaming).mockResolvedValue(passed);
  });

  afterEach(async () => {
    runningApps.clear();
    vi.clearAllMocks();
    vi.mocked(isDockerRuntimeActive).mockReturnValue(false);
    await fs.rm(root, { recursive: true, force: true });
  });

  async function mockSnapshot() {
    const worktreePath = path.join(root, "userData", "snap");
    const snapshotAppPath = path.join(worktreePath, "app");
    await fs.mkdir(snapshotAppPath, { recursive: true });
    await fs.writeFile(path.join(snapshotAppPath, "pnpm-lock.yaml"), "");
    vi.mocked(createGitOverlayWorkspace).mockResolvedValue({
      targetPath: snapshotAppPath,
      worktreePath,
      setupMs: 1,
      sourceTargetPath: appPath,
      sourceRepoPath: root,
    } as Awaited<ReturnType<typeof createGitOverlayWorkspace>>);
    return { worktreePath, snapshotAppPath };
  }

  it("describes where project code runs in each runtime mode", () => {
    expect(runBuildTool.getConsentPreview?.({})).toContain(
      "with your user account",
    );
    vi.mocked(isDockerRuntimeActive).mockReturnValue(true);
    const dockerPreview = runBuildTool.getConsentPreview?.({});
    expect(dockerPreview).toContain("inside the container");
    expect(dockerPreview).not.toContain("user account");
  });

  it("runs an in-place Docker build in the guest against the app volume", async () => {
    vi.mocked(isDockerRuntimeActive).mockReturnValue(true);

    await expect(runBuildTool.execute({}, makeCtx(501))).resolves.toContain(
      "Production build passed. Mode: in-place",
    );

    expect(spawnStreaming).not.toHaveBeenCalled();
    expect(getPnpmMinimumReleaseAgeSupport).not.toHaveBeenCalled();
    expect(appGuestInput).toHaveBeenCalledExactlyOnceWith({
      appId: 501,
      appPath,
      cwd: appPath,
      command: "pnpm",
      args: ["run", "build"],
    });
    expect(runGuestStreaming).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "app" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("installs and builds an isolated Docker snapshot in the guest", async () => {
    vi.mocked(isDockerRuntimeActive).mockReturnValue(true);
    runningApps.set(502, { mode: "docker" } as never);
    const { worktreePath, snapshotAppPath } = await mockSnapshot();

    await expect(runBuildTool.execute({}, makeCtx(502))).resolves.toContain(
      "Production build passed. Mode: isolated",
    );

    expect(spawnStreaming).not.toHaveBeenCalled();
    expect(getPnpmMinimumReleaseAgeSupport).not.toHaveBeenCalled();
    expect(appGuestInput).not.toHaveBeenCalled();
    const inputs = vi
      .mocked(snapshotGuestInput)
      .mock.calls.map(([input]) => input);
    expect(inputs).toEqual([
      {
        appId: 502,
        snapshotRoot: worktreePath,
        cwd: snapshotAppPath,
        command: "pnpm",
        args: expect.arrayContaining(["install", "--frozen-lockfile"]),
        env: undefined,
      },
      {
        appId: 502,
        snapshotRoot: worktreePath,
        cwd: snapshotAppPath,
        command: "pnpm",
        args: ["run", "build"],
      },
    ]);
    expect(runGuestStreaming).toHaveBeenCalledTimes(2);
  });

  it("keeps Local-mode installs and builds on the host", async () => {
    runningApps.set(503, { mode: "docker" } as never);
    const { snapshotAppPath } = await mockSnapshot();

    await expect(runBuildTool.execute({}, makeCtx(503))).resolves.toContain(
      "Production build passed. Mode: isolated",
    );

    expect(runGuestStreaming).not.toHaveBeenCalled();
    expect(getPnpmMinimumReleaseAgeSupport).toHaveBeenCalled();
    expect(
      vi
        .mocked(spawnStreaming)
        .mock.calls.map(([options]) => [
          options.command,
          options.args,
          options.cwd,
          options.env?.COREPACK_ENABLE_STRICT,
        ]),
    ).toEqual([
      [
        "npm",
        ["install", "--legacy-peer-deps", "--prefer-offline"],
        snapshotAppPath,
        "0",
      ],
      ["npm", ["run", "build"], snapshotAppPath, "0"],
    ]);
  });
});
