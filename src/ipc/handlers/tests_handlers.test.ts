import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { RemoveFileAndCommitResult } from "../services/git_service";
import { apps } from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/main/settings";
import { runningApps } from "../utils/process_manager";
import {
  appOperationCoordinator,
  type AppOperationRequest,
} from "../services/app_operation_coordinator";
import { activeRecordings } from "../services/recording_registry";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";

// Every app folder lives under one throwaway base so the delete handler runs
// against real directories (its path guards resolve symlinks on disk).
const TEMP_BASE = path.join(os.tmpdir(), "dyad-tests-handler-tests");

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: {
    getPath: vi.fn(() =>
      path.join(os.tmpdir(), "dyad-tests-handler-user-data"),
    ),
    getAppPath: vi.fn(() => process.cwd()),
  },
}));

vi.mock("@/paths/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/paths/paths")>();
  const nodePath = await import("node:path");
  const nodeOs = await import("node:os");
  const base = nodePath.join(nodeOs.tmpdir(), "dyad-tests-handler-tests");
  return {
    ...actual,
    getDyadAppPath: (appPath: string) =>
      nodePath.isAbsolute(appPath) ? appPath : nodePath.join(base, appPath),
  };
});

vi.mock("../utils/git_utils", () => ({
  gitAdd: vi.fn(async () => {}),
  gitRemove: vi.fn(async () => {}),
}));

// Stands in for `git rm` + commit: like the real thing it removes the file from
// disk itself, and reports whether the deletion made it into history. Tests
// override it for the untracked / failed-commit paths.
const removeFileAndCommitMock = vi.hoisted(() =>
  vi.fn(
    async ({
      path: repoPath,
      filepath,
    }: {
      path: string;
      filepath: string;
      message: string;
    }): Promise<RemoveFileAndCommitResult> => {
      const nodeFs = await import("node:fs");
      const nodePath = await import("node:path");
      nodeFs.rmSync(nodePath.join(repoPath, filepath), { force: true });
      return { commitHash: "commit-hash", uncommittedReason: null };
    },
  ),
);
vi.mock("../services/git_service", () => ({
  gitService: { removeFileAndCommit: removeFileAndCommitMock },
}));

const queueCloudSandboxSnapshotSyncMock = vi.hoisted(() => vi.fn());
const prepareIsolatedTestDatabaseMock = vi.hoisted(() => vi.fn());
const readSettingsMock = vi.hoisted(() => vi.fn());
const sendTelemetryEventMock = vi.hoisted(() => vi.fn());
const ensurePlaywrightBootstrapMock = vi.hoisted(() => vi.fn());
const createE2eTestWorkspaceMock = vi.hoisted(() => vi.fn());
const retainE2eTestArtifactsMock = vi.hoisted(() => vi.fn());
const startE2eTestRuntimeMock = vi.hoisted(() => vi.fn());
const spawnStreamingMock = vi.hoisted(() => vi.fn());
const broadcastToRegisteredWindowsMock = vi.hoisted(() => vi.fn());
// Partially mocked: this module is pulled in transitively by the runtime
// service, so replacing it wholesale breaks whenever an unrelated export is
// added. Only the snapshot sync needs to be stubbed out here.
vi.mock("../utils/cloud_sandbox_provider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../utils/cloud_sandbox_provider")>();
  return {
    ...actual,
    queueCloudSandboxSnapshotSync: queueCloudSandboxSnapshotSyncMock,
  };
});
vi.mock("../services/isolated_test_db", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/isolated_test_db")>();
  return {
    ...actual,
    prepareIsolatedTestDatabase: prepareIsolatedTestDatabaseMock,
  };
});
vi.mock("../utils/playwright_bootstrap", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../utils/playwright_bootstrap")>();
  return {
    ...actual,
    ensurePlaywrightBootstrap: ensurePlaywrightBootstrapMock,
  };
});
vi.mock("../utils/socket_firewall", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../utils/socket_firewall")>();
  return {
    ...actual,
    getPackageManagerCommandEnv: vi.fn(
      (env: NodeJS.ProcessEnv = process.env) => env,
    ),
  };
});
vi.mock("../services/e2e_test_workspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/e2e_test_workspace")>();
  return {
    ...actual,
    createE2eTestWorkspace: createE2eTestWorkspaceMock,
    retainE2eTestArtifacts: retainE2eTestArtifactsMock,
  };
});
vi.mock("../services/e2e_test_runtime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/e2e_test_runtime")>();
  return { ...actual, startE2eTestRuntime: startE2eTestRuntimeMock };
});
vi.mock("@/main/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/main/settings")>();
  return { ...actual, readSettings: readSettingsMock };
});
vi.mock("../utils/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/telemetry")>();
  return { ...actual, sendTelemetryEvent: sendTelemetryEventMock };
});
vi.mock("../utils/spawn_streaming", () => ({
  spawnStreaming: spawnStreamingMock,
}));
vi.mock("@/ipc/utils/window_broadcast", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/ipc/utils/window_broadcast")>();
  return {
    ...actual,
    broadcastToRegisteredWindows: broadcastToRegisteredWindowsMock,
  };
});

// Imported after the mocks so the handler module picks them up.
const { registerTestsHandlers, runAppTestsWithIsolation } =
  await import("./tests_handlers");

describe("tests handlers", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    activeRecordings.clear();
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEMP_BASE, { recursive: true });
    removeFileAndCommitMock.mockClear();
    queueCloudSandboxSnapshotSyncMock.mockClear();
    prepareIsolatedTestDatabaseMock.mockReset();
    readSettingsMock.mockReset();
    readSettingsMock.mockImplementation(() =>
      structuredClone(DEFAULT_SETTINGS),
    );
    sendTelemetryEventMock.mockReset();
    ensurePlaywrightBootstrapMock.mockReset();
    ensurePlaywrightBootstrapMock.mockResolvedValue({ installed: false });
    retainE2eTestArtifactsMock.mockReset();
    retainE2eTestArtifactsMock.mockResolvedValue(undefined);
    createE2eTestWorkspaceMock.mockReset();
    createE2eTestWorkspaceMock.mockImplementation(
      async ({ appPath }: { appPath: string }) => ({
        workspacePath: appPath,
        artifactPath: path.join(TEMP_BASE, "artifacts"),
        dispose: vi.fn(),
      }),
    );
    startE2eTestRuntimeMock.mockReset();
    startE2eTestRuntimeMock.mockResolvedValue({
      baseUrl: "http://127.0.0.1:49999",
      process: null,
      stop: vi.fn(),
    });
    spawnStreamingMock.mockReset();
    spawnStreamingMock.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "no report",
      aborted: false,
      timedOut: false,
    });
    broadcastToRegisteredWindowsMock.mockClear();
    harness = setupHandlerTestHarness();
    registerTestsHandlers();
  });

  afterEach(() => {
    harness.dispose();
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
  });

  /** Seeds an app row plus its on-disk folder, and returns its id. */
  function seedApp(name: string): number {
    fs.mkdirSync(path.join(TEMP_BASE, name, "e2e-tests"), { recursive: true });
    const result = harness.db.insert(apps).values({ name, path: name }).run();
    return Number(result.lastInsertRowid);
  }

  function writeSpec(name: string, relativePath: string): string {
    const full = path.join(TEMP_BASE, name, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "test('a', async () => {});\n");
    return full;
  }

  describe("tests:run", () => {
    it("releases the working tree after snapshotting the sandbox", async () => {
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        infraError: { message: "setup stopped" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });
      const requests: AppOperationRequest[] = [];
      const originalRun = appOperationCoordinator.run.bind(
        appOperationCoordinator,
      );
      const runSpy = vi
        .spyOn(appOperationCoordinator, "run")
        .mockImplementation((request, operation) => {
          requests.push(request);
          return originalRun(request, operation);
        });

      try {
        await runAppTestsWithIsolation({
          event: { sender: {} } as any,
          appId,
          source: "panel",
        });
      } finally {
        runSpy.mockRestore();
      }

      expect(
        requests.find(({ operation }) => operation === "run-app-tests"),
      ).toMatchObject({
        resources: [
          { resource: "app-path", mode: "read" },
          "provider",
          "test-files",
        ],
        allowCompatibleQueueBypass: true,
      });
      expect(
        requests.find(
          ({ operation }) => operation === "prepare-e2e-test-workspace",
        ),
      ).toMatchObject({
        resources: [
          { resource: "app-path", mode: "read" },
          { resource: "repository-ref", mode: "read" },
          "repository-worktree",
          "test-files",
        ],
        // Same as the run stage: while the snapshot waits behind an unrelated
        // blocker, work that only conflicts with it on `test-files` must not
        // queue behind the whole test run.
        allowCompatibleQueueBypass: true,
      });
    });

    it("refuses atomically when a recording starts at coordinator admission", async () => {
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      const originalRun = appOperationCoordinator.run.bind(
        appOperationCoordinator,
      );
      const runSpy = vi
        .spyOn(appOperationCoordinator, "run")
        .mockImplementation((request, operation) => {
          if (request.operation === "run-app-tests") {
            activeRecordings.set(appId, {
              appId,
              stop: () => {},
              done: Promise.resolve({ envRestored: true }),
            });
          }
          return originalRun(request, operation);
        });

      try {
        await expect(
          runAppTestsWithIsolation({
            event: { sender: {} } as any,
            appId,
            source: "panel",
          }),
        ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
        expect(prepareIsolatedTestDatabaseMock).not.toHaveBeenCalled();
      } finally {
        runSpy.mockRestore();
        activeRecordings.delete(appId);
      }
    });

    it("reports a leaked test branch, not an unrestored sandbox env", async () => {
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "neon-branch" },
        infraError: {
          message: "Isolation setup stopped before running tests.",
        },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: false,
        }),
      });

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toMatch(/isolated test database/i);
      expect(result.infraError?.message).toMatch(/settings were not changed/i);
    });

    it("stays quiet when only the sandbox env was left unrestored", async () => {
      // The sandbox `.env.local` is deleted with the workspace seconds later,
      // so `envRestored` says nothing the user needs to hear.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "neon-branch" },
        infraError: {
          message: "Isolation setup stopped before running tests.",
        },
        teardown: vi.fn().mockResolvedValue({
          envRestored: false,
          remoteCleanupCompleted: true,
        }),
      });

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toBe(
        "Isolation setup stopped before running tests.",
      );
    });

    it("authorizes the isolated server origin before Playwright starts", async () => {
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      const events: string[] = [];
      const authorizeRuntimeOrigin = vi.fn(async () => {
        events.push("authorize");
      });
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "neon-branch" },
        authorizeRuntimeOrigin,
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });
      startE2eTestRuntimeMock.mockImplementation(async () => {
        events.push("server");
        return {
          baseUrl: "http://127.0.0.1:49999/path",
          process: null,
          stop: vi.fn(),
        };
      });
      spawnStreamingMock.mockImplementation(async () => {
        events.push("playwright");
        return {
          code: 1,
          stdout: "",
          stderr: "no report",
          aborted: false,
          timedOut: false,
        };
      });

      await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(authorizeRuntimeOrigin).toHaveBeenCalledWith(
        "http://127.0.0.1:49999",
      );
      expect(events).toEqual(["server", "authorize", "playwright"]);
    });

    it("stops and cleans up when Neon origin authorization fails", async () => {
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      const stop = vi.fn().mockResolvedValue(undefined);
      const teardown = vi
        .fn()
        .mockResolvedValue({ envRestored: true, remoteCleanupCompleted: true });
      const dispose = vi.fn().mockResolvedValue(undefined);
      createE2eTestWorkspaceMock.mockResolvedValue({
        workspacePath: path.join(TEMP_BASE, "app"),
        artifactPath: path.join(TEMP_BASE, "artifacts"),
        dispose,
      });
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "neon-branch" },
        authorizeRuntimeOrigin: vi
          .fn()
          .mockRejectedValue(new Error("Neon unavailable")),
        teardown,
      });
      startE2eTestRuntimeMock.mockResolvedValue({
        baseUrl: "http://127.0.0.1:49999",
        process: null,
        stop,
      });

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toMatch(/Neon Auth/i);
      expect(spawnStreamingMock).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalledOnce();
      expect(teardown).toHaveBeenCalledOnce();
      expect(dispose).toHaveBeenCalledOnce();
    });

    it("refuses a testing-disabled app before bootstrapping or copying", async () => {
      const appId = seedApp("app");

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toMatch(/Testing isn't enabled/i);
      // Bootstrap writes into the user's real project and the snapshot copies
      // the whole app; a refusal must stay side-effect-free.
      expect(ensurePlaywrightBootstrapMock).not.toHaveBeenCalled();
      expect(createE2eTestWorkspaceMock).not.toHaveBeenCalled();
    });

    it("reports the first run in telemetry when bootstrap installed Playwright", async () => {
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      ensurePlaywrightBootstrapMock.mockResolvedValue({ installed: true });
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });
      spawnStreamingMock.mockImplementation(
        async ({ cwd }: { cwd: string }) => {
          const reportPath = path.join(cwd, "test-results", "results.json");
          fs.mkdirSync(path.dirname(reportPath), { recursive: true });
          fs.writeFileSync(
            reportPath,
            JSON.stringify({
              suites: [
                {
                  file: "e2e-tests/a.spec.ts",
                  specs: [
                    {
                      title: "works",
                      file: "e2e-tests/a.spec.ts",
                      line: 1,
                      tests: [{ status: "expected", results: [{}] }],
                    },
                  ],
                },
              ],
            }),
          );
          return {
            code: 0,
            stdout: "",
            stderr: "",
            aborted: false,
            timedOut: false,
          };
        },
      );

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError).toBeUndefined();
      expect(sendTelemetryEventMock).toHaveBeenCalledWith(
        "e2e_tests_run",
        expect.objectContaining({ first_run: true }),
      );
    });

    it("returns cleanly when Stop lands during the sandbox copy", async () => {
      // The workspace copy and the test-server start both signal cancellation
      // by throwing. Letting that escape rejects the IPC call and records an
      // internal product exception for an ordinary user cancellation.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      const stop = new AbortController();
      createE2eTestWorkspaceMock.mockImplementation(async () => {
        stop.abort();
        throw new Error("Test run stopped.");
      });

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
        externalSignal: stop.signal,
      });

      expect(result.infraError?.message).toBe("Test run stopped.");
      expect(startE2eTestRuntimeMock).not.toHaveBeenCalled();
    });

    it("reports a failed Playwright bootstrap as an infra error, not a crash", async () => {
      // This call used to live inside `runAppTestsCore`, which classified it as
      // an `infraError`. Letting it escape from the sandbox prepare stage would
      // reject the IPC call, record an internal product exception, and throw
      // out of the agent's turn instead of counting as a non-attempt.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      ensurePlaywrightBootstrapMock.mockRejectedValue(
        new Error("npm registry unreachable"),
      );

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toMatch(/registry unreachable/i);
      expect(result.results).toEqual([]);
      expect(createE2eTestWorkspaceMock).not.toHaveBeenCalled();
    });

    it("reports a failed sandbox copy as an infra error, not a crash", async () => {
      // The Run button is enabled without a dev server now, so an app whose
      // dependencies were never installed reaches this — and must be told so,
      // not answered with a rejected IPC call.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      createE2eTestWorkspaceMock.mockRejectedValue(
        new DyadError(
          "The app's dependencies are not installed. Start the app successfully before running tests.",
          DyadErrorKind.Precondition,
        ),
      );

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toMatch(
        /dependencies are not installed/i,
      );
      expect(startE2eTestRuntimeMock).not.toHaveBeenCalled();
    });

    it("keeps a finished run's results when artifact retention fails", async () => {
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });
      // Windows still holding a trace file, a full disk — retention is
      // best-effort and must cost at most the screenshots.
      retainE2eTestArtifactsMock.mockRejectedValue(new Error("EBUSY"));
      spawnStreamingMock.mockImplementation(
        async ({ cwd }: { cwd: string }) => {
          const reportPath = path.join(cwd, "test-results", "results.json");
          fs.mkdirSync(path.dirname(reportPath), { recursive: true });
          fs.writeFileSync(
            reportPath,
            JSON.stringify({
              suites: [
                {
                  file: "e2e-tests/a.spec.ts",
                  specs: [
                    {
                      title: "works",
                      ok: true,
                      tests: [{ results: [{ status: "passed" }] }],
                    },
                  ],
                },
              ],
            }),
          );
          return {
            code: 0,
            stdout: "",
            stderr: "",
            aborted: false,
            timedOut: false,
          };
        },
      );

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError).toBeUndefined();
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe("passed");
    });

    it("routes around the sandbox when the user turned it off", async () => {
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      readSettingsMock.mockImplementation(() => ({
        ...structuredClone(DEFAULT_SETTINGS),
        disableSandboxedE2eTests: true,
      }));
      runningApps.set(appId, { proxyUrl: "http://localhost:32100" } as any);
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });

      let result;
      try {
        result = await runAppTestsWithIsolation({
          event: { sender: {} } as any,
          appId,
          source: "panel",
        });
      } finally {
        runningApps.clear();
      }

      expect(createE2eTestWorkspaceMock).not.toHaveBeenCalled();
      expect(startE2eTestRuntimeMock).not.toHaveBeenCalled();
      expect(spawnStreamingMock).toHaveBeenCalled();
      expect(result.isolation?.reason).toMatch(/turned off in Settings/i);
    });

    describe("non-host runtime", () => {
      afterEach(() => {
        runningApps.clear();
      });

      function seedRunningApp(name: string): number {
        const appId = seedApp(name);
        harness.db
          .update(apps)
          .set({ testingEnabled: true })
          .where(eq(apps.id, appId))
          .run();
        readSettingsMock.mockImplementation(() => ({
          ...structuredClone(DEFAULT_SETTINGS),
          runtimeMode2: "docker",
        }));
        runningApps.set(appId, { proxyUrl: "http://localhost:32100" } as any);
        return appId;
      }

      it("keeps running against the normal preview and discloses the gap", async () => {
        const appId = seedRunningApp("app");
        prepareIsolatedTestDatabaseMock.mockResolvedValue({
          isolation: { mode: "supabase-test-user" },
          teardown: vi.fn().mockResolvedValue({
            envRestored: true,
            remoteCleanupCompleted: true,
          }),
        });

        const result = await runAppTestsWithIsolation({
          event: { sender: {} } as any,
          appId,
          source: "panel",
        });

        expect(spawnStreamingMock).toHaveBeenCalled();
        expect(createE2eTestWorkspaceMock).not.toHaveBeenCalled();
        expect(startE2eTestRuntimeMock).not.toHaveBeenCalled();
        expect(result.isolation).toMatchObject({
          mode: "supabase-test-user",
          reason: expect.stringMatching(/docker runtime/i),
        });
      });

      it("refuses a Neon app rather than testing against the real database", async () => {
        const appId = seedRunningApp("app");
        harness.db
          .update(apps)
          .set({ neonProjectId: "neon-project" })
          .where(eq(apps.id, appId))
          .run();

        const result = await runAppTestsWithIsolation({
          event: { sender: {} } as any,
          appId,
          source: "panel",
        });

        expect(result.infraError?.message).toMatch(/real database/i);
        expect(prepareIsolatedTestDatabaseMock).not.toHaveBeenCalled();
        expect(spawnStreamingMock).not.toHaveBeenCalled();
      });
    });
  });

  describe("stop progress events", () => {
    /** `tests:run-state` values broadcast so far, in order. */
    function runStates(): string[] {
      return broadcastToRegisteredWindowsMock.mock.calls
        .filter(([, channel]) => channel === "tests:run-state")
        .map(([, , payload]) => payload.state);
    }

    function runStatePayloads(): Array<{
      runId: number;
      state: string;
      wasStopped?: boolean;
    }> {
      return broadcastToRegisteredWindowsMock.mock.calls
        .filter(([, channel]) => channel === "tests:run-state")
        .map(([, , payload]) => payload);
    }

    function seedTestableApp(name: string): number {
      const appId = seedApp(name);
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      return appId;
    }

    it("announces the teardown before it starts", async () => {
      // The teardown takes no AbortSignal and routinely outlasts the process
      // kill, so it has to be announced up front — not reported afterwards.
      const appId = seedTestableApp("app");
      let statesWhenTeardownRan: string[] = [];
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "neon-branch" },
        teardown: vi.fn().mockImplementation(async () => {
          statesWhenTeardownRan = runStates();
          return { envRestored: true, remoteCleanupCompleted: true };
        }),
      });

      await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(statesWhenTeardownRan).toContain("cleaning-up");
      // And it is not terminal: `finished` still lands after the teardown.
      expect(statesWhenTeardownRan).not.toContain("finished");
      expect(runStates()).toContain("finished");
    });

    it("announces the sandbox deletion even with no isolation to tear down", async () => {
      // `NOOP_TEARDOWN` returns immediately, but removing the cloned
      // node_modules tree does not, and the panel keeps Run/Record/Delete
      // disabled for all of it. An unlabelled wait reads as a hang.
      const appId = seedTestableApp("app");
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });

      await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(runStates()).toContain("cleaning-up");
    });

    it("stays quiet when no sandbox was taken and there is nothing to tear down", async () => {
      // Without a sandbox to delete, `NOOP_TEARDOWN` returns immediately and a
      // `cleaning-up` label would flash for a frame and read as a glitch.
      const appId = seedTestableApp("app");
      readSettingsMock.mockImplementation(() => ({
        ...structuredClone(DEFAULT_SETTINGS),
        disableSandboxedE2eTests: true,
      }));
      runningApps.set(appId, { proxyUrl: "http://localhost:32100" } as any);
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });

      try {
        await runAppTestsWithIsolation({
          event: { sender: {} } as any,
          appId,
          source: "panel",
        });
      } finally {
        runningApps.clear();
      }

      expect(createE2eTestWorkspaceMock).not.toHaveBeenCalled();
      expect(runStates()).not.toContain("cleaning-up");
    });

    it("reports the kill for a run stopped from the chat", async () => {
      // The agent turn's cancellation reaches the same controller as the
      // panel's Stop button, so one listener has to cover both surfaces.
      const appId = seedTestableApp("app");
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });

      await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "agent",
        externalSignal: AbortSignal.abort(),
      });

      expect(runStates()).toContain("stopping");
      const stopping = runStatePayloads().find(
        (payload) => payload.state === "stopping",
      );
      expect(stopping?.runId).toEqual(expect.any(Number));
      expect(stopping?.wasStopped).toBe(true);
    });

    it("does not emit stale progress when a newer run supersedes it", async () => {
      const appId = seedTestableApp("app");
      let resolveFirstPrepare!: (value: {
        isolation: { mode: "neon-branch" };
        infraError: { message: string };
        teardown: () => Promise<{
          envRestored: boolean;
          remoteCleanupCompleted: boolean;
        }>;
      }) => void;
      prepareIsolatedTestDatabaseMock
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirstPrepare = resolve;
          }),
        )
        .mockResolvedValueOnce({
          isolation: { mode: "none" },
          infraError: { message: "second run stopped before execution" },
          teardown: vi.fn().mockResolvedValue({
            envRestored: true,
            remoteCleanupCompleted: true,
          }),
        });

      const firstRun = runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });
      await vi.waitFor(() => {
        expect(prepareIsolatedTestDatabaseMock).toHaveBeenCalledTimes(1);
      });

      const secondRun = runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });
      resolveFirstPrepare({
        isolation: { mode: "neon-branch" },
        infraError: { message: "first run stopped before execution" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });

      await Promise.all([firstRun, secondRun]);

      // The superseded run must contribute no progress at all. The replacement
      // legitimately announces its own sandbox deletion, so the assertion is
      // scoped to the first run's generation rather than to the whole stream.
      const supersededRunId = Math.min(
        ...runStatePayloads().map((payload) => payload.runId),
      );
      const supersededStates = runStatePayloads()
        .filter((payload) => payload.runId === supersededRunId)
        .map((payload) => payload.state);
      expect(supersededStates).not.toContain("stopping");
      expect(supersededStates).not.toContain("cleaning-up");
    });

    it("attributes a queued run's stop to its own generation", async () => {
      const appId = seedTestableApp("app");
      let resolveFirstPrepare!: (value: {
        isolation: { mode: "neon-branch" };
        infraError: { message: string };
        teardown: () => Promise<{
          envRestored: boolean;
          remoteCleanupCompleted: boolean;
        }>;
      }) => void;
      prepareIsolatedTestDatabaseMock
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirstPrepare = resolve;
          }),
        )
        .mockResolvedValueOnce({
          isolation: { mode: "none" },
          infraError: { message: "queued run stopped before execution" },
          teardown: vi.fn().mockResolvedValue({
            envRestored: true,
            remoteCleanupCompleted: true,
          }),
        });

      const firstRun = runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });
      await vi.waitFor(() => {
        expect(prepareIsolatedTestDatabaseMock).toHaveBeenCalledTimes(1);
      });

      const secondAbort = new AbortController();
      const secondRun = runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "agent",
        externalSignal: secondAbort.signal,
      });
      secondAbort.abort();

      const beforePriorFinishes = runStatePayloads();
      const started = beforePriorFinishes.filter(
        (payload) => payload.state === "started",
      );
      const stopping = beforePriorFinishes.find(
        (payload) => payload.state === "stopping",
      );
      expect(started).toHaveLength(2);
      expect(stopping?.runId).toBe(started[1].runId);
      expect(stopping?.runId).not.toBe(started[0].runId);

      resolveFirstPrepare({
        isolation: { mode: "neon-branch" },
        infraError: { message: "first run superseded" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });
      await Promise.all([firstRun, secondRun]);
    });
  });

  describe("tests:delete", () => {
    it("deletes the spec file and commits the removal on its own", async () => {
      const appId = seedApp("app");
      const specPath = writeSpec("app", "e2e-tests/signup.spec.ts");

      const result = await harness.invokeHandler<{
        file: string;
        committed: boolean;
      }>("tests:delete", { appId, testFile: "e2e-tests/signup.spec.ts" });

      expect(result).toEqual({
        file: "e2e-tests/signup.spec.ts",
        committed: true,
        uncommittedReason: null,
      });
      expect(fs.existsSync(specPath)).toBe(false);
      expect(removeFileAndCommitMock).toHaveBeenCalledWith({
        path: path.join(TEMP_BASE, "app"),
        filepath: "e2e-tests/signup.spec.ts",
        message: "delete test e2e-tests/signup.spec.ts",
      });
      expect(queueCloudSandboxSnapshotSyncMock).toHaveBeenCalledWith({
        appId,
        deletedPaths: ["e2e-tests/signup.spec.ts"],
      });
    });

    it("still reports success when the file isn't tracked by git", async () => {
      const appId = seedApp("app");
      const specPath = writeSpec("app", "e2e-tests/nested/checkout.spec.ts");
      // Git removed nothing, so the file is still on disk for the handler.
      removeFileAndCommitMock.mockResolvedValueOnce({
        commitHash: null,
        uncommittedReason: "untracked",
      });

      const result = await harness.invokeHandler<{
        file: string;
        committed: boolean;
      }>("tests:delete", {
        appId,
        testFile: "e2e-tests/nested/checkout.spec.ts",
      });

      // Nothing was committed, so the UI knows not to promise a recovery path
      // that doesn't exist for untracked files.
      expect(result).toEqual({
        file: "e2e-tests/nested/checkout.spec.ts",
        committed: false,
        uncommittedReason: "untracked",
      });
      expect(fs.existsSync(specPath)).toBe(false);
    });

    it("reports a failed commit separately from an untracked file", async () => {
      const appId = seedApp("app");
      const specPath = writeSpec("app", "e2e-tests/signup.spec.ts");
      // `git rm` succeeded (file gone, deletion staged) but the commit didn't.
      removeFileAndCommitMock.mockImplementationOnce(async () => {
        fs.rmSync(specPath);
        return {
          commitHash: null,
          uncommittedReason: "commit-failed" as const,
        };
      });

      const result = await harness.invokeHandler<{
        file: string;
        committed: boolean;
      }>("tests:delete", { appId, testFile: "e2e-tests/signup.spec.ts" });

      // The deletion is staged, so the UI can point at pending changes rather
      // than calling it unrecoverable.
      expect(result).toEqual({
        file: "e2e-tests/signup.spec.ts",
        committed: false,
        uncommittedReason: "commit-failed",
      });
      expect(fs.existsSync(specPath)).toBe(false);
    });

    it("leaves a concurrently recreated file alone once git removed the original", async () => {
      const appId = seedApp("app");
      const specPath = writeSpec("app", "e2e-tests/signup.spec.ts");
      // A save landing right after `git rm` recreates the path. The handler must
      // not unlink it: that content was never confirmed for deletion.
      removeFileAndCommitMock.mockImplementationOnce(async () => {
        fs.rmSync(specPath);
        fs.writeFileSync(specPath, "test('recreated', async () => {});\n");
        return { commitHash: "commit-hash", uncommittedReason: null };
      });

      await harness.invokeHandler("tests:delete", {
        appId,
        testFile: "e2e-tests/signup.spec.ts",
      });

      expect(fs.readFileSync(specPath, "utf8")).toContain("recreated");
    });

    it.each([
      ["a file outside e2e-tests/", "src/main.ts"],
      ["a traversal path", "e2e-tests/../../secrets.spec.ts"],
      ["a non-spec file inside e2e-tests/", "e2e-tests/helpers.ts"],
      ["an absolute path", "/etc/passwd"],
    ])("rejects %s", async (_label, testFile) => {
      const appId = seedApp("app");
      const outside = path.join(TEMP_BASE, "secrets.spec.ts");
      fs.writeFileSync(outside, "secret");
      const helper = writeSpec("app", "e2e-tests/helpers.ts");

      await expect(
        harness.invokeHandler("tests:delete", { appId, testFile }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });

      expect(fs.existsSync(outside)).toBe(true);
      expect(fs.existsSync(helper)).toBe(true);
      expect(removeFileAndCommitMock).not.toHaveBeenCalled();
    });

    it("reports a missing spec as not found", async () => {
      const appId = seedApp("app");

      await expect(
        harness.invokeHandler("tests:delete", {
          appId,
          testFile: "e2e-tests/gone.spec.ts",
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });

      expect(removeFileAndCommitMock).not.toHaveBeenCalled();
    });

    it("doesn't delete another app's spec", async () => {
      seedApp("app-a");
      const otherAppId = seedApp("app-b");
      const specA = writeSpec("app-a", "e2e-tests/signup.spec.ts");

      await expect(
        harness.invokeHandler("tests:delete", {
          appId: otherAppId,
          testFile: "e2e-tests/signup.spec.ts",
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });

      expect(fs.existsSync(specA)).toBe(true);
    });
  });
});
