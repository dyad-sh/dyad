import { neonPreviewDomainService } from "./neon_preview_domain_service";
import {
  ensureSupabasePreviewRedirects,
  resolveSupabasePreviewTarget,
} from "./supabase_preview_redirect_service";
import type { PreviewAuthTarget } from "./preview_auth_target";
import {
  reconcileRunningNeonPreview,
  reconcileRunningSupabasePreview,
} from "./app_runtime_service";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { Worker } from "node:worker_threads";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getPnpmMinimumReleaseAgeSupportMock,
  ensurePnpmAllowBuildsConfiguredMock,
  readSettingsMock,
  readPnpmIgnoredBuildsMock,
  recordDeniedPnpmBuildsMock,
  parsePnpmIgnoredBuildsFromOutputMock,
  safeSendMock,
  sendTelemetryEventMock,
  spawnMock,
  killPortMock,
  startProxyMock,
} = vi.hoisted(() => ({
  getPnpmMinimumReleaseAgeSupportMock: vi.fn<
    () => Promise<{
      available: boolean;
      minimumReleaseAgeSupported: boolean;
      warningMessage?: string;
    }>
  >(async () => ({
    available: false,
    minimumReleaseAgeSupported: false,
  })),
  ensurePnpmAllowBuildsConfiguredMock:
    vi.fn<
      (
        args: unknown,
      ) => Promise<{ changed: boolean; promotedPackages: string[] }>
    >(),
  readSettingsMock: vi.fn<() => Record<string, unknown>>(() => ({
    runtimeMode2: "host",
  })),
  readPnpmIgnoredBuildsMock: vi.fn(),
  recordDeniedPnpmBuildsMock: vi.fn(),
  parsePnpmIgnoredBuildsFromOutputMock: vi.fn<
    (output: string) => { packageName: string; packageSpec: string }[]
  >(() => []),
  safeSendMock: vi.fn(),
  sendTelemetryEventMock: vi.fn(),
  spawnMock: vi.fn(),
  killPortMock: vi.fn<() => Promise<void>>(async () => {}),
  startProxyMock: vi.fn(),
}));

vi.mock("@/ipc/services/neon_preview_domain_service", () => ({
  resolveNeonPreviewTarget: vi.fn().mockResolvedValue(null),
  neonPreviewDomainService: {
    ensureTrustedDomain: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/ipc/services/supabase_preview_redirect_service", () => ({
  ensureSupabasePreviewRedirects: vi.fn().mockResolvedValue(undefined),
  resolveSupabasePreviewTarget: vi.fn().mockResolvedValue(null),
}));

vi.mock("node:child_process", () => ({
  default: {
    spawn: spawnMock,
  },
  spawn: spawnMock,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("fix-path", () => ({
  default: vi.fn(),
}));

vi.mock("kill-port", () => ({
  default: killPortMock,
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => readSettingsMock(),
}));

vi.mock("@/ipc/utils/safe_sender", () => ({
  safeSend: (...args: unknown[]) => safeSendMock(...args),
}));

vi.mock("@/ipc/utils/socket_firewall", () => ({
  ensurePnpmAllowBuildsConfigured: (args: unknown) =>
    ensurePnpmAllowBuildsConfiguredMock(args),
  getPackageManagerCommandEnv: () => ({
    ...process.env,
    COREPACK_ENABLE_PROJECT_SPEC: "0",
    COREPACK_ENABLE_STRICT: "0",
    npm_config_package_manager_strict: "false",
    npm_config_pm_on_fail: "ignore",
  }),
  getPnpmMinimumReleaseAgeSupport: () => getPnpmMinimumReleaseAgeSupportMock(),
  getBestEffortPnpmRebuildCommand: (packageNames: string[]) =>
    packageNames.length === 0
      ? null
      : `(pnpm rebuild ${packageNames.join(" ")} || echo pnpm rebuild skipped)`,
  isPnpmIgnoredBuildsError: (error: unknown) =>
    String(error).includes("ERR_PNPM_IGNORED_BUILDS"),
  parsePnpmIgnoredBuildsFromOutput: (output: string) =>
    parsePnpmIgnoredBuildsFromOutputMock(output),
  readPnpmIgnoredBuilds: (...args: unknown[]) =>
    readPnpmIgnoredBuildsMock(...args),
  recordDeniedPnpmBuilds: (...args: unknown[]) =>
    recordDeniedPnpmBuildsMock(...args),
  PNPM_INSTALL_POLICY_ARGS: [
    "--config.pm-on-fail=ignore",
    "--minimum-release-age=1440",
  ],
  PNPM_GLOBAL_INSTALL_PACKAGE: "pnpm@latest-11",
  PNPM_PM_ON_FAIL_IGNORE_ARG: "--config.pm-on-fail=ignore",
}));

vi.mock("@/ipc/utils/telemetry", () => ({
  sendTelemetryEvent: (...args: unknown[]) => sendTelemetryEventMock(...args),
}));

vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  buildCloudSandboxFileMap: vi.fn(),
  CloudSandboxApiError: class CloudSandboxApiError extends Error {
    code?: string;
    status?: number;
  },
  createCloudSandbox: vi.fn(),
  destroyCloudSandbox: vi.fn(),
  queueCloudSandboxSnapshotSync: vi.fn(),
  registerRunningCloudSandbox: vi.fn(),
  restartCloudSandbox: vi.fn(),
  setCloudSandboxSyncUpdateListener: vi.fn(),
  stopCloudSandboxFileSync: vi.fn(),
  streamCloudSandboxLogs: vi.fn(),
  unregisterRunningCloudSandbox: vi.fn(),
  uploadCloudSandboxFiles: vi.fn(),
}));

vi.mock("@/ipc/utils/start_proxy_server", () => ({
  startProxy: (...args: unknown[]) => startProxyMock(...args),
}));

import {
  ensureProxyForRunningApp,
  appRuntimeService,
  executeApp,
  startCloudSandboxLogStream,
  type AppRuntimeOutput,
} from "./app_runtime_service";
import {
  buildCloudSandboxFileMap,
  createCloudSandbox,
  queueCloudSandboxSnapshotSync,
  registerRunningCloudSandbox,
  streamCloudSandboxLogs,
  uploadCloudSandboxFiles,
} from "@/ipc/utils/cloud_sandbox_provider";
import { processCounter, runningApps } from "@/ipc/utils/process_manager";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

class FakeChildProcess extends EventEmitter {
  pid: number;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = {
    write: vi.fn(),
  };

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

function createEvent(): Electron.IpcMainInvokeEvent {
  const sender = {
    isDestroyed: () => false,
    isCrashed: () => false,
    send: vi.fn(),
  } as unknown as WebContents;

  return { sender } as IpcMainInvokeEvent;
}

function createOutput(
  event: Electron.IpcMainInvokeEvent = createEvent(),
): AppRuntimeOutput {
  return {
    send: (output) => safeSendMock(event.sender, "app:output", output),
    enqueue: (output) => safeSendMock(event.sender, "app:output", output),
    flush: vi.fn(),
  };
}

async function createTempAppDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "dyad-runtime-pm-"));
}

async function writePackageJson(
  appPath: string,
  packageJson: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    path.join(appPath, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );
}

async function createMarker(
  appPath: string,
  relativePath: string,
): Promise<void> {
  const markerPath = path.join(appPath, relativePath);
  await mkdir(path.dirname(markerPath), { recursive: true });
  await writeFile(markerPath, "");
}

async function withCorepackProjectSpecEnv<T>(
  value: string,
  callback: () => Promise<T>,
): Promise<T> {
  const originalValue = process.env.COREPACK_ENABLE_PROJECT_SPEC;
  process.env.COREPACK_ENABLE_PROJECT_SPEC = value;
  try {
    return await callback();
  } finally {
    if (originalValue === undefined) {
      delete process.env.COREPACK_ENABLE_PROJECT_SPEC;
    } else {
      process.env.COREPACK_ENABLE_PROJECT_SPEC = originalValue;
    }
  }
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (lastError) {
    throw lastError;
  }
  assertion();
}

describe("executeApp", () => {
  beforeEach(async () => {
    await Promise.all(
      [...runningApps.values()].map((appInfo) => {
        appInfo.proxyAbortController?.abort();
        return appInfo.previewAuthRegistration?.settled;
      }),
    );
    runningApps.clear();
    processCounter.value = 0;
    getPnpmMinimumReleaseAgeSupportMock.mockReset();
    getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
      available: false,
      minimumReleaseAgeSupported: false,
    });
    ensurePnpmAllowBuildsConfiguredMock.mockReset();
    ensurePnpmAllowBuildsConfiguredMock.mockResolvedValue({
      changed: false,
      promotedPackages: [],
    });
    readSettingsMock.mockReset();
    readSettingsMock.mockReturnValue({
      runtimeMode2: "host",
    });
    readPnpmIgnoredBuildsMock.mockReset();
    readPnpmIgnoredBuildsMock.mockResolvedValue([]);
    recordDeniedPnpmBuildsMock.mockReset();
    recordDeniedPnpmBuildsMock.mockResolvedValue({ deniedBuilds: [] });
    parsePnpmIgnoredBuildsFromOutputMock.mockReset();
    parsePnpmIgnoredBuildsFromOutputMock.mockReturnValue([]);
    safeSendMock.mockReset();
    sendTelemetryEventMock.mockReset();
    spawnMock.mockReset();
    killPortMock.mockReset();
    killPortMock.mockResolvedValue(undefined);
    vi.mocked(neonPreviewDomainService.ensureTrustedDomain)
      .mockReset()
      .mockResolvedValue(undefined);
    vi.mocked(resolveSupabasePreviewTarget).mockReset().mockResolvedValue(null);
    vi.mocked(ensureSupabasePreviewRedirects)
      .mockReset()
      .mockResolvedValue(undefined);
    startProxyMock.mockReset();
    startProxyMock.mockImplementation(async (_url, opts) => {
      opts.onStarted(`http://${opts.hostname}:${opts.port}`);
      return { terminate: vi.fn() };
    });
  });

  it("does not emit app-exit when a replaced process closes later", async () => {
    const firstProcess = new FakeChildProcess(101);
    const secondProcess = new FakeChildProcess(102);
    spawnMock
      .mockReturnValueOnce(firstProcess)
      .mockReturnValueOnce(secondProcess);

    await executeApp({
      appPath: "/tmp/app",
      appId: 1,
      output: createOutput(),
      isNeon: false,
    });
    await executeApp({
      appPath: "/tmp/app",
      appId: 1,
      output: createOutput(),
      isNeon: false,
    });

    firstProcess.emit("close", 1, null);

    expect(safeSendMock).not.toHaveBeenCalledWith(
      expect.anything(),
      "app:output",
      expect.objectContaining({ type: "app-exit" }),
    );
    expect(runningApps.get(1)?.process).toBe(
      secondProcess as unknown as ChildProcess,
    );
  });

  it("emits app-exit when the current process closes", async () => {
    const process = new FakeChildProcess(101);
    spawnMock.mockReturnValueOnce(process);

    const event = createEvent();
    await executeApp({
      appPath: "/tmp/app",
      appId: 1,
      output: createOutput(event),
      isNeon: false,
    });

    process.emit("close", 1, null);

    expect(safeSendMock).toHaveBeenCalledWith(
      event.sender,
      "app:output",
      expect.objectContaining({
        type: "app-exit",
        appId: 1,
        exitCode: 1,
        signal: null,
      }),
    );
    expect(runningApps.has(1)).toBe(false);
  });

  it("uses pnpm when pnpm is available but too old for minimumReleaseAge", async () => {
    const process = new FakeChildProcess(101);
    spawnMock.mockReturnValueOnce(process);
    getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
      available: true,
      minimumReleaseAgeSupported: false,
      warningMessage:
        "Install pnpm 10.16.0 or newer for the strongest protection",
    });
    readSettingsMock.mockReturnValue({
      runtimeMode2: "host",
      enablePnpmMinimumReleaseAgeWarning: true,
    });

    const event = createEvent();
    await executeApp({
      appPath: "/tmp/app",
      appId: 1,
      output: createOutput(event),
      isNeon: false,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "pnpm --config.pm-on-fail=ignore --minimum-release-age=1440 install && pnpm --config.pm-on-fail=ignore run dev --port 32101",
      [],
      expect.objectContaining({
        cwd: "/tmp/app",
        env: expect.objectContaining({
          COREPACK_ENABLE_PROJECT_SPEC: "0",
          COREPACK_ENABLE_STRICT: "0",
          npm_config_package_manager_strict: "false",
          npm_config_pm_on_fail: "ignore",
        }),
        shell: true,
      }),
    );
    expect(ensurePnpmAllowBuildsConfiguredMock).toHaveBeenCalledWith({
      appPath: "/tmp/app",
    });
    expect(safeSendMock).toHaveBeenCalledWith(
      event.sender,
      "app:output",
      expect.objectContaining({
        type: "package-manager-warning",
        message: "Install pnpm 10.16.0 or newer for the strongest protection",
      }),
    );
  });

  it("rebuilds promoted pnpm builds before starting the dev server", async () => {
    const process = new FakeChildProcess(101);
    spawnMock.mockReturnValueOnce(process);
    getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
      available: true,
      minimumReleaseAgeSupported: true,
    });
    ensurePnpmAllowBuildsConfiguredMock.mockResolvedValue({
      changed: true,
      promotedPackages: ["core-js", "@scope/native"],
    });

    await executeApp({
      appPath: "/tmp/app",
      appId: 1,
      output: createOutput(),
      isNeon: false,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "pnpm --config.pm-on-fail=ignore --minimum-release-age=1440 install && (pnpm rebuild core-js @scope/native || echo pnpm rebuild skipped) && pnpm --config.pm-on-fail=ignore run dev --port 32101",
      [],
      expect.objectContaining({
        cwd: "/tmp/app",
        shell: true,
      }),
    );
  });

  it("records ignored builds once the default install reaches the dev server", async () => {
    const process = new FakeChildProcess(101);
    spawnMock.mockReturnValueOnce(process);
    getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
      available: true,
      minimumReleaseAgeSupported: true,
    });
    const ignoredBuilds = [
      { packageName: "core-js", packageSpec: "core-js@3.49.0" },
    ];
    readPnpmIgnoredBuildsMock.mockResolvedValue(ignoredBuilds);
    recordDeniedPnpmBuildsMock.mockResolvedValue({
      deniedBuilds: ignoredBuilds,
    });

    await executeApp({
      appPath: "/tmp/app",
      appId: 1,
      output: createOutput(),
      isNeon: false,
    });

    process.stdout.emit("data", "Local: http://localhost:32101/\n");
    process.stdout.emit("data", "Local: http://localhost:32101/\n");

    await waitForAssertion(() => {
      expect(recordDeniedPnpmBuildsMock).toHaveBeenCalledWith({
        appPath: "/tmp/app",
        ignoredBuilds,
      });
      expect(sendTelemetryEventMock).toHaveBeenCalledWith(
        "pnpm:build-auto-denied",
        {
          packages: ["core-js@3.49.0"],
          source: "app-run",
        },
      );
    });
    // One-shot: repeated URL output must not re-record.
    expect(recordDeniedPnpmBuildsMock).toHaveBeenCalledTimes(1);
  });

  it("records ignored builds surfaced in cloud sandbox logs", async () => {
    const event = createEvent();
    runningApps.set(7, {
      process: null,
      processId: 1,
      mode: "cloud",
      output: createOutput(event),
      cloudSandboxId: "sb-1",
      lastViewedAt: Date.now(),
    } as any);
    const ignoredBuilds = [
      { packageName: "core-js", packageSpec: "core-js@3.49.0" },
    ];
    vi.mocked(streamCloudSandboxLogs).mockImplementation(async function* () {
      yield "Ignored build scripts: core-js@3.49.0.";
    });
    parsePnpmIgnoredBuildsFromOutputMock.mockReturnValue(ignoredBuilds);
    recordDeniedPnpmBuildsMock.mockResolvedValue({
      deniedBuilds: ignoredBuilds,
    });

    startCloudSandboxLogStream({
      appId: 7,
      appPath: "/tmp/cloud-app",
      output: createOutput(event),
      sandboxId: "sb-1",
      cloudLogAbortController: new AbortController(),
    });

    await waitForAssertion(() => {
      expect(recordDeniedPnpmBuildsMock).toHaveBeenCalledWith({
        appPath: "/tmp/cloud-app",
        ignoredBuilds,
      });
      expect(sendTelemetryEventMock).toHaveBeenCalledWith(
        "pnpm:build-auto-denied",
        {
          packages: ["core-js@3.49.0"],
          source: "cloud-sandbox",
        },
      );
    });
  });

  it("queues a catch-up sync after registering a new cloud sandbox", async () => {
    readSettingsMock.mockReturnValue({ runtimeMode2: "cloud" });
    vi.mocked(createCloudSandbox).mockResolvedValueOnce({
      sandboxId: "sb-1",
      previewUrl: "https://preview.example.test",
      previewAuthToken: "preview-token",
    });
    vi.mocked(buildCloudSandboxFileMap).mockResolvedValueOnce({});
    vi.mocked(uploadCloudSandboxFiles).mockResolvedValueOnce({});

    await executeApp({
      appPath: "/tmp/cloud-app",
      appId: 7,
      output: createOutput(),
      isNeon: false,
    });

    expect(registerRunningCloudSandbox).toHaveBeenCalledWith({
      appId: 7,
      appPath: "/tmp/cloud-app",
      sandboxId: "sb-1",
    });
    expect(queueCloudSandboxSnapshotSync).toHaveBeenCalledWith({
      appId: 7,
      fullSync: true,
      immediate: true,
    });
    expect(
      vi.mocked(registerRunningCloudSandbox).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(queueCloudSandboxSnapshotSync).mock.invocationCallOrder[0],
    );
  });

  it("does not warn about old pnpm for apps that explicitly use npm", async () => {
    const appPath = await createTempAppDir();
    try {
      await writePackageJson(appPath, { packageManager: "npm@10.8.2" });
      const process = new FakeChildProcess(101);
      spawnMock.mockReturnValueOnce(process);
      getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
        available: true,
        minimumReleaseAgeSupported: false,
        warningMessage:
          "Install pnpm 10.16.0 or newer for the strongest protection",
      });
      readSettingsMock.mockReturnValue({
        runtimeMode2: "host",
        enablePnpmMinimumReleaseAgeWarning: true,
      });

      await executeApp({
        appPath,
        appId: 1,
        output: createOutput(),
        isNeon: false,
      });

      expect(String(spawnMock.mock.calls[0][0]).startsWith("(npm")).toBe(true);
      expect(safeSendMock).not.toHaveBeenCalledWith(
        expect.anything(),
        "app:output",
        expect.objectContaining({ type: "package-manager-warning" }),
      );
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("warns when a pnpm-preferring app falls back to npm because pnpm is unavailable", async () => {
    const appPath = await createTempAppDir();
    try {
      await createMarker(appPath, "pnpm-lock.yaml");
      const process = new FakeChildProcess(101);
      spawnMock.mockReturnValueOnce(process);
      getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
        available: false,
        minimumReleaseAgeSupported: false,
        warningMessage:
          "Install pnpm 10.16.0 or newer for the strongest protection",
      });
      readSettingsMock.mockReturnValue({
        runtimeMode2: "host",
        enablePnpmMinimumReleaseAgeWarning: true,
      });

      const event = createEvent();
      await executeApp({
        appPath,
        appId: 1,
        output: createOutput(event),
        isNeon: false,
      });

      expect(String(spawnMock.mock.calls[0][0]).startsWith("(npm")).toBe(true);
      expect(safeSendMock).toHaveBeenCalledWith(
        event.sender,
        "app:output",
        expect.objectContaining({
          type: "package-manager-warning",
          message: "Install pnpm 10.16.0 or newer for the strongest protection",
        }),
      );
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("emits the pnpm version migration nudge only once per app session", async () => {
    const appPath = await createTempAppDir();
    try {
      await writePackageJson(appPath, { name: "app" });
      await writeFile(
        path.join(appPath, "pnpm-lock.yaml"),
        "lockfileVersion: '6.0'\n",
      );
      const firstProcess = new FakeChildProcess(101);
      const secondProcess = new FakeChildProcess(102);
      spawnMock
        .mockReturnValueOnce(firstProcess)
        .mockReturnValueOnce(secondProcess);
      getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
        available: true,
        minimumReleaseAgeSupported: true,
      });

      await executeApp({
        appPath,
        appId: 90,
        output: createOutput(),
        isNeon: false,
      });
      await executeApp({
        appPath,
        appId: 90,
        output: createOutput(),
        isNeon: false,
      });

      const migrationNudges = safeSendMock.mock.calls.filter((call) => {
        return (
          call[1] === "app:output" &&
          typeof call[2]?.message === "string" &&
          call[2].message.includes('apply "Migrate to pnpm')
        );
      });
      expect(migrationNudges).toHaveLength(1);
      const migrationWarnings = safeSendMock.mock.calls.filter((call) => {
        return (
          call[1] === "app:output" &&
          call[2]?.type === "package-manager-warning" &&
          call[2]?.warningKind === "pnpm-migration"
        );
      });
      expect(migrationWarnings).toHaveLength(2);
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("does not emit the pnpm version migration nudge outside host mode", async () => {
    const appPath = await createTempAppDir();
    try {
      await writePackageJson(appPath, { name: "app" });
      await writeFile(
        path.join(appPath, "pnpm-lock.yaml"),
        "lockfileVersion: '6.0'\n",
      );
      readSettingsMock.mockReturnValue({
        runtimeMode2: "cloud",
      });

      await expect(
        executeApp({
          appPath,
          appId: 91,
          output: createOutput(),
          isNeon: false,
        }),
      ).rejects.toThrow();

      expect(safeSendMock).not.toHaveBeenCalledWith(
        expect.anything(),
        "app:output",
        expect.objectContaining({
          message: expect.stringContaining('apply "Migrate to pnpm'),
        }),
      );
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it.each<
    [
      string,
      (appPath: string) => Promise<void>,
      { pnpmAvailable: boolean; expectedCommandPrefix: "pnpm" | "(npm" },
    ]
  >([
    [
      "uses pnpm when packageManager starts with pnpm@",
      (appPath) => writePackageJson(appPath, { packageManager: "pnpm@11.9.0" }),
      { pnpmAvailable: true, expectedCommandPrefix: "pnpm" },
    ],
    [
      "uses npm when packageManager starts with pnpm@ but pnpm is unavailable",
      (appPath) => writePackageJson(appPath, { packageManager: "pnpm@11.9.0" }),
      { pnpmAvailable: false, expectedCommandPrefix: "(npm" },
    ],
    [
      "uses npm when packageManager starts with npm@",
      (appPath) => writePackageJson(appPath, { packageManager: "npm@10.8.2" }),
      { pnpmAvailable: true, expectedCommandPrefix: "(npm" },
    ],
    [
      "uses pnpm when node_modules is pnpm-shaped even with both lockfiles",
      async (appPath) => {
        await createMarker(appPath, "pnpm-lock.yaml");
        await createMarker(appPath, "package-lock.json");
        await createMarker(appPath, "node_modules/.pnpm/.keep");
      },
      { pnpmAvailable: true, expectedCommandPrefix: "pnpm" },
    ],
    [
      "uses npm when node_modules is npm-shaped even with both lockfiles",
      async (appPath) => {
        await createMarker(appPath, "pnpm-lock.yaml");
        await createMarker(appPath, "package-lock.json");
        await createMarker(appPath, "node_modules/.package-lock.json");
      },
      { pnpmAvailable: true, expectedCommandPrefix: "(npm" },
    ],
    [
      "uses pnpm when only pnpm-lock.yaml exists",
      (appPath) => createMarker(appPath, "pnpm-lock.yaml"),
      { pnpmAvailable: true, expectedCommandPrefix: "pnpm" },
    ],
    [
      "uses npm when only pnpm-lock.yaml exists but pnpm is unavailable",
      (appPath) => createMarker(appPath, "pnpm-lock.yaml"),
      { pnpmAvailable: false, expectedCommandPrefix: "(npm" },
    ],
    [
      "uses npm when only package-lock.json exists",
      (appPath) => createMarker(appPath, "package-lock.json"),
      { pnpmAvailable: true, expectedCommandPrefix: "(npm" },
    ],
    [
      "uses pnpm when both lockfiles exist and node_modules has no shape",
      async (appPath) => {
        await createMarker(appPath, "pnpm-lock.yaml");
        await createMarker(appPath, "package-lock.json");
      },
      { pnpmAvailable: true, expectedCommandPrefix: "pnpm" },
    ],
    [
      "uses pnpm for no-signal apps when pnpm is available",
      async () => {},
      { pnpmAvailable: true, expectedCommandPrefix: "pnpm" },
    ],
    [
      "uses npm for no-signal apps when pnpm is unavailable",
      async () => {},
      { pnpmAvailable: false, expectedCommandPrefix: "(npm" },
    ],
  ])("%s", async (_, arrangeApp, { pnpmAvailable, expectedCommandPrefix }) => {
    const appPath = await createTempAppDir();
    try {
      await arrangeApp(appPath);
      const process = new FakeChildProcess(101);
      spawnMock.mockReturnValueOnce(process);
      getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
        available: pnpmAvailable,
        minimumReleaseAgeSupported: pnpmAvailable,
      });

      await executeApp({
        appPath,
        appId: 1,
        output: createOutput(),
        isNeon: false,
      });

      expect(
        String(spawnMock.mock.calls[0][0]).startsWith(expectedCommandPrefix),
      ).toBe(true);
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("does not disable Corepack project specs for npm fallback commands", async () => {
    await withCorepackProjectSpecEnv("1", async () => {
      const process = new FakeChildProcess(101);
      spawnMock.mockReturnValueOnce(process);

      await executeApp({
        appPath: "/tmp/app",
        appId: 1,
        output: createOutput(),
        isNeon: false,
      });

      expect(spawnMock).toHaveBeenCalledWith(
        "(npm install --legacy-peer-deps && npm run dev -- --port 32101)",
        [],
        expect.objectContaining({
          cwd: "/tmp/app",
          env: expect.objectContaining({
            COREPACK_ENABLE_PROJECT_SPEC: "1",
          }),
          shell: true,
        }),
      );
      expect(ensurePnpmAllowBuildsConfiguredMock).not.toHaveBeenCalled();
    });
  });

  it("does not disable Corepack project specs for custom commands", async () => {
    await withCorepackProjectSpecEnv("1", async () => {
      const process = new FakeChildProcess(101);
      spawnMock.mockReturnValueOnce(process);

      await executeApp({
        appPath: "/tmp/app",
        appId: 1,
        output: createOutput(),
        isNeon: false,
        installCommand: "pnpm install --frozen-lockfile",
        startCommand: "pnpm run preview -- --port 32101",
      });

      expect(spawnMock).toHaveBeenCalledWith(
        "pnpm install --frozen-lockfile && pnpm run preview -- --port 32101",
        [],
        expect.objectContaining({
          cwd: "/tmp/app",
          env: expect.objectContaining({
            COREPACK_ENABLE_PROJECT_SPEC: "1",
          }),
          shell: true,
        }),
      );
      expect(getPnpmMinimumReleaseAgeSupportMock).not.toHaveBeenCalled();
      expect(ensurePnpmAllowBuildsConfiguredMock).not.toHaveBeenCalled();
    });
  });

  it("clears node_modules before retrying custom pnpm commands after ignored builds are denied", async () => {
    const appPath = await createTempAppDir();
    const nodeModulesPath = path.join(appPath, "node_modules");
    await mkdir(nodeModulesPath, { recursive: true });
    readPnpmIgnoredBuildsMock.mockResolvedValue([
      {
        packageSpec: "fake-build-dep@file:packages/fake-build-dep",
        packageName: "fake-build-dep",
      },
    ]);
    recordDeniedPnpmBuildsMock.mockResolvedValue({
      deniedBuilds: [
        {
          packageSpec: "fake-build-dep@file:packages/fake-build-dep",
          packageName: "fake-build-dep",
        },
      ],
    });

    try {
      const firstProcess = new FakeChildProcess(101);
      const secondProcess = new FakeChildProcess(102);
      spawnMock
        .mockReturnValueOnce(firstProcess)
        .mockReturnValueOnce(secondProcess);

      await executeApp({
        appPath,
        appId: 1,
        output: createOutput(),
        isNeon: false,
        installCommand: "pnpm --config.strictDepBuilds=true install",
        startCommand: "pnpm run dev",
      });

      firstProcess.stderr.emit(
        "data",
        "ERR_PNPM_IGNORED_BUILDS Ignored build scripts: fake-build-dep@file:packages/fake-build-dep",
      );
      firstProcess.emit("close", 1, null);

      await waitForAssertion(() => {
        expect(spawnMock).toHaveBeenCalledTimes(2);
      });
      await expect(stat(nodeModulesPath)).rejects.toThrow();
      expect(recordDeniedPnpmBuildsMock).toHaveBeenCalledWith({
        appPath,
        ignoredBuilds: [
          {
            packageSpec: "fake-build-dep@file:packages/fake-build-dep",
            packageName: "fake-build-dep",
          },
        ],
      });
      expect(sendTelemetryEventMock).toHaveBeenCalledWith(
        "pnpm:build-auto-denied",
        {
          packages: ["fake-build-dep@file:packages/fake-build-dep"],
          source: "self-heal",
        },
      );
      expect(runningApps.get(1)?.process).toBe(
        secondProcess as unknown as ChildProcess,
      );
      expect(safeSendMock).not.toHaveBeenCalledWith(
        expect.anything(),
        "app:output",
        expect.objectContaining({ type: "app-exit" }),
      );
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  describe.each(["neon", "supabase"] as const)(
    "%s preview auth registration",
    (provider) => {
      const target: PreviewAuthTarget =
        provider === "neon"
          ? { provider, projectId: "project", branchId: "active" }
          : { provider, projectId: "project", organizationSlug: "org" };
      const ensure =
        provider === "neon"
          ? vi.mocked(neonPreviewDomainService.ensureTrustedDomain)
          : vi.mocked(ensureSupabasePreviewRedirects);

      function seed() {
        const output = createOutput();
        runningApps.set(42, {
          process: null,
          processId: 8,
          mode: "host",
          lastViewedAt: 0,
          output,
          previewAuthTarget: target,
        });
        return {
          appId: 42,
          output,
          originalUrl: "http://localhost:32142",
          mode: "host" as const,
        };
      }

      async function reconcile(next: PreviewAuthTarget | null) {
        if (provider === "neon") {
          await reconcileRunningNeonPreview(
            42,
            next?.provider === "neon" ? next : null,
          );
        } else {
          vi.mocked(resolveSupabasePreviewTarget).mockResolvedValueOnce(
            next?.provider === "supabase" ? next : null,
          );
          await reconcileRunningSupabasePreview(42);
        }
      }

      it("allows a late ready URL to recover after the startup wait times out", async () => {
        const request = seed();
        const controller = new AbortController();
        runningApps.get(42)!.proxyAbortController = controller;
        await expect(
          appRuntimeService.waitForReady(42, { timeoutMs: 0 }),
        ).rejects.toThrow("Timed out");
        expect(controller.signal.aborted).toBe(false);
        await ensureProxyForRunningApp(request);
        await appRuntimeService.waitForReady(42);
        await runningApps.get(42)?.previewAuthRegistration?.settled;
        expect(runningApps.get(42)?.proxyUrl).toBe(
          "http://app-42.localhost:42142",
        );
      });

      it("publishes an already-running preview without waiting for provider registration", async () => {
        const request = seed();
        ensure.mockImplementation(() => new Promise<void>(() => {}));
        await ensureProxyForRunningApp(request);
        safeSendMock.mockClear();
        try {
          await appRuntimeService.start({ appId: 42, output: request.output });
          expect(safeSendMock).toHaveBeenCalledWith(
            expect.anything(),
            "app:output",
            expect.objectContaining({
              previewAuth: { provider, state: "pending" },
            }),
          );
        } finally {
          const registration = runningApps.get(42)?.previewAuthRegistration;
          registration?.controller.abort();
          await registration?.settled;
        }
      });

      it("opens the preview with the actual port while registration is pending, then clears the banner", async () => {
        let finish!: () => void;
        ensure.mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        );
        const request = seed();
        startProxyMock.mockImplementation(async (_url, opts) => {
          opts.onStarted("http://app-42.localhost:42999");
          opts.onStarted("http://app-42.localhost:42142");
          return { terminate: vi.fn() };
        });
        await Promise.all([
          ensureProxyForRunningApp(request),
          ensureProxyForRunningApp(request),
        ]);
        await vi.waitFor(() => expect(ensure).toHaveBeenCalledOnce());
        expect(runningApps.get(42)?.proxyUrl).toBe(
          "http://app-42.localhost:42999",
        );
        expect(safeSendMock).toHaveBeenCalledOnce();
        expect(safeSendMock).toHaveBeenLastCalledWith(
          expect.anything(),
          "app:output",
          expect.objectContaining({
            previewAuth: { provider, state: "pending" },
          }),
        );
        expect(ensure).toHaveBeenCalledWith(
          expect.objectContaining({
            origin: "http://app-42.localhost:42999",
            target: expect.objectContaining({ projectId: "project" }),
          }),
        );
        // Repeated dev-server logs reuse the proxy and the pending registration.
        await ensureProxyForRunningApp(request);
        expect(ensure).toHaveBeenCalledOnce();
        const registration = runningApps.get(42)!.previewAuthRegistration!;
        finish();
        await registration.settled;
        expect(startProxyMock).toHaveBeenCalledOnce();
        expect(safeSendMock).toHaveBeenLastCalledWith(
          expect.anything(),
          "app:output",
          expect.objectContaining({ previewAuth: undefined }),
        );
        expect(runningApps.get(42)?.proxyUrl).toBe(
          "http://app-42.localhost:42999",
        );
      });

      it("keeps the preview open after failure and clears the warning on a successful retry", async () => {
        const request = seed();
        ensure.mockRejectedValueOnce(new Error("private upstream details"));
        await ensureProxyForRunningApp(request);
        await runningApps.get(42)?.previewAuthRegistration?.settled;
        expect(runningApps.get(42)?.proxyUrl).toBe(
          "http://app-42.localhost:42142",
        );
        expect(safeSendMock).toHaveBeenLastCalledWith(
          expect.anything(),
          "app:output",
          expect.objectContaining({
            previewAuth: {
              provider,
              state: "error",
              message: expect.stringMatching(/restart and retry/i),
            },
          }),
        );
        expect(JSON.stringify(safeSendMock.mock.calls)).not.toContain(
          "private upstream details",
        );
        await reconcile(target);
        await runningApps.get(42)?.previewAuthRegistration?.settled;
        expect(ensure).toHaveBeenCalledTimes(2);
        expect(runningApps.get(42)?.previewAuth).toBeUndefined();
        expect(safeSendMock).toHaveBeenLastCalledWith(
          expect.anything(),
          "app:output",
          expect.objectContaining({ previewAuth: undefined }),
        );
        expect(startProxyMock).toHaveBeenCalledOnce();
      });

      it("cancels the old provider target and ignores its late failure after switching", async () => {
        let failOld!: (error: Error) => void;
        let finishNew!: () => void;
        ensure
          .mockImplementationOnce(
            () =>
              new Promise<void>((_resolve, reject) => {
                failOld = reject;
              }),
          )
          .mockImplementationOnce(
            () =>
              new Promise<void>((resolve) => {
                finishNew = resolve;
              }),
          );
        await ensureProxyForRunningApp(seed());
        await vi.waitFor(() => expect(ensure).toHaveBeenCalledOnce());
        const oldSignal = ensure.mock.calls[0][0].signal;
        const next: PreviewAuthTarget =
          target.provider === "neon"
            ? { ...target, branchId: "new" }
            : { ...target, projectId: "new-project" };
        await reconcile(next);
        expect(oldSignal.aborted).toBe(true);
        await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(2));
        const { provider: _provider, ...expectedTarget } = next;
        expect(ensure).toHaveBeenLastCalledWith(
          expect.objectContaining({
            target: expect.objectContaining(expectedTarget),
          }),
        );
        safeSendMock.mockClear();
        failOld(new Error("Old project failed"));
        await Promise.resolve();
        expect(runningApps.get(42)?.previewAuth).toEqual({
          provider,
          state: "pending",
        });
        expect(safeSendMock).not.toHaveBeenCalled();
        const registration = runningApps.get(42)!.previewAuthRegistration!;
        finishNew();
        await registration.settled;
        expect(runningApps.get(42)?.previewAuth).toBeUndefined();
        expect(safeSendMock).toHaveBeenCalledOnce();
      });

      it.each(["pending", "error"])(
        "clears %s registration when the provider is disconnected",
        async (state) => {
          if (state === "pending")
            ensure.mockImplementationOnce(() => new Promise(() => {}));
          else ensure.mockRejectedValueOnce(new Error("Failed"));
          await ensureProxyForRunningApp(seed());
          await vi.waitFor(() => expect(ensure).toHaveBeenCalledOnce());
          if (state === "error")
            await runningApps.get(42)?.previewAuthRegistration?.settled;
          await reconcile(null);
          expect(runningApps.get(42)?.previewAuthRegistration).toBeUndefined();
          expect(runningApps.get(42)?.previewAuthTarget).toBeNull();
          expect(safeSendMock).toHaveBeenLastCalledWith(
            expect.anything(),
            "app:output",
            expect.objectContaining({ previewAuth: undefined }),
          );
          if (state === "pending")
            expect(ensure.mock.calls[0][0].signal.aborted).toBe(true);
        },
      );

      it.each(["runtime", "isolated-test", "replacement"])(
        "ignores late completion after %s cancellation",
        async (source) => {
          let finish!: () => void;
          ensure.mockImplementationOnce(
            () =>
              new Promise<void>((resolve) => {
                finish = resolve;
              }),
          );
          const externalAbort = new AbortController();
          const request = seed();
          const info = runningApps.get(42)!;
          if (source === "isolated-test")
            info.previewAbortSignal = externalAbort.signal;
          await ensureProxyForRunningApp(request);
          await vi.waitFor(() => expect(ensure).toHaveBeenCalledOnce());
          const registration = info.previewAuthRegistration!;
          const signal = ensure.mock.calls[0][0].signal;
          safeSendMock.mockClear();
          if (source === "runtime") info.proxyAbortController!.abort();
          else if (source === "isolated-test") externalAbort.abort();
          else seed();
          finish();
          await registration.settled;
          if (source !== "replacement") expect(signal.aborted).toBe(true);
          expect(safeSendMock).not.toHaveBeenCalled();
          expect(info.previewAuthRegistration).toBeUndefined();
        },
      );
    },
  );

  it("captures the Supabase association before starting the runtime", async () => {
    vi.mocked(resolveSupabasePreviewTarget).mockResolvedValueOnce({
      projectId: "branch-ref",
      organizationSlug: "org",
    });
    spawnMock.mockReturnValueOnce(new FakeChildProcess(123));
    await executeApp({
      appPath: "/tmp/app",
      appId: 42,
      output: createOutput(),
      isNeon: false,
    });
    expect(runningApps.get(42)?.previewAuthTarget).toEqual({
      provider: "supabase",
      projectId: "branch-ref",
      organizationSlug: "org",
    });
  });

  it("keeps an association change made before the proxy is ready", async () => {
    const output = createOutput();
    runningApps.set(42, {
      process: null,
      processId: 8,
      mode: "host",
      lastViewedAt: 0,
      output,
    });
    vi.mocked(resolveSupabasePreviewTarget).mockResolvedValueOnce({
      projectId: "new-project",
      organizationSlug: "new-org",
    });
    await reconcileRunningSupabasePreview(42);
    await ensureProxyForRunningApp({
      appId: 42,
      output,
      originalUrl: "http://localhost:32142",
      mode: "host",
    });
    await runningApps.get(42)?.previewAuthRegistration?.settled;
    expect(ensureSupabasePreviewRedirects).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          provider: "supabase",
          projectId: "new-project",
          organizationSlug: "new-org",
        },
      }),
    );
  });

  it("starts the proxy on the deterministic port without killing the occupant", async () => {
    const terminate = vi.fn();
    startProxyMock.mockImplementation(async (_originalUrl, opts) => {
      opts.onStarted?.("http://app-42.localhost:42142");
      return { terminate };
    });
    runningApps.set(42, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
    });

    const event = createEvent();
    await ensureProxyForRunningApp({
      appId: 42,
      output: createOutput(event),
      originalUrl: "http://localhost:32142",
      mode: "host",
    });

    expect(startProxyMock).toHaveBeenCalledWith(
      "http://localhost:32142",
      expect.objectContaining({
        port: 42142,
        hostname: "app-42.localhost",
        authBootstrapToken: expect.any(String),
      }),
    );
    expect(neonPreviewDomainService.ensureTrustedDomain).not.toHaveBeenCalled();
    const proxyOptions = startProxyMock.mock.calls[0][1];
    expect(proxyOptions.authBootstrapToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(runningApps.get(42)?.authBootstrapToken).toBe(
      proxyOptions.authBootstrapToken,
    );
    // We must never evict whatever already holds the deterministic proxy port —
    // the worker scans the fallback band instead.
    expect(killPortMock).not.toHaveBeenCalledWith(42142, "tcp");
  });

  it("discards a late proxy callback from a replaced process", async () => {
    let onStarted: ((proxyUrl: string) => void) | undefined;
    startProxyMock.mockImplementation(async (_originalUrl, opts) => {
      onStarted = opts.onStarted;
      return { terminate: vi.fn() };
    });
    const oldRef = {
      kind: "app-run",
      entityKey: 42,
      operationId: "app-run:old",
    } as const;
    const newRef = {
      kind: "app-run",
      entityKey: 42,
      operationId: "app-run:new",
    } as const;
    runningApps.set(42, {
      process: null,
      processId: 1,
      invocationRef: oldRef,
      mode: "host",
      lastViewedAt: Date.now(),
    });

    const event = createEvent();
    const startup = ensureProxyForRunningApp({
      appId: 42,
      output: createOutput(event),
      originalUrl: "http://localhost:32142",
      mode: "host",
      invocationRef: oldRef,
    });
    await vi.waitFor(() => expect(onStarted).toBeDefined());
    runningApps.set(42, {
      process: null,
      processId: 2,
      invocationRef: newRef,
      mode: "host",
      lastViewedAt: Date.now(),
    });

    onStarted?.("http://app-42.localhost:42142");
    await startup;

    expect(safeSendMock).not.toHaveBeenCalledWith(
      event.sender,
      "app:output",
      expect.objectContaining({
        invocationRef: oldRef,
        message: expect.stringContaining("http://app-42.localhost:42142"),
      }),
    );
    expect(runningApps.get(42)?.proxyUrl).toBeUndefined();
  });

  it("does not let an old invocation terminate the replacement proxy", async () => {
    const oldRef = {
      kind: "app-run",
      entityKey: 42,
      operationId: "app-run:old",
    } as const;
    const newRef = {
      kind: "app-run",
      entityKey: 42,
      operationId: "app-run:new",
    } as const;
    const terminateReplacement = vi.fn();
    runningApps.set(42, {
      process: null,
      processId: 2,
      invocationRef: newRef,
      mode: "host",
      proxyWorker: {
        terminate: terminateReplacement,
      } as unknown as Worker,
      proxyUrl: "http://app-42.localhost:42142",
      originalUrl: "http://localhost:32142",
      lastViewedAt: Date.now(),
    });

    await ensureProxyForRunningApp({
      appId: 42,
      output: createOutput(),
      originalUrl: "http://localhost:39999",
      mode: "host",
      invocationRef: oldRef,
    });

    expect(terminateReplacement).not.toHaveBeenCalled();
    expect(startProxyMock).not.toHaveBeenCalled();
    expect(runningApps.get(42)).toMatchObject({
      invocationRef: newRef,
      proxyUrl: "http://app-42.localhost:42142",
      originalUrl: "http://localhost:32142",
    });
  });

  it("surfaces a proxy port-exhaustion error to the renderer", async () => {
    const terminate = vi.fn();
    startProxyMock.mockImplementation(async (_originalUrl, opts) => {
      opts.onError?.(new DyadError("all ports in use", DyadErrorKind.Conflict));
      return { terminate };
    });
    runningApps.set(42, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
    });

    const event = createEvent();
    await ensureProxyForRunningApp({
      appId: 42,
      output: createOutput(event),
      originalUrl: "http://localhost:32142",
      mode: "host",
    });

    expect(safeSendMock).toHaveBeenCalledWith(
      expect.anything(),
      "app:output",
      expect.objectContaining({
        type: "stderr",
        message: expect.stringContaining("all ports in use"),
        appId: 42,
      }),
    );
  });
});
