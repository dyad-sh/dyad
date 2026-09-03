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
import { windowRegistry } from "@/window_infrastructure/main/window_registry";
import { TEST_BASE_URL_ENV } from "../utils/playwright_bootstrap";
import { WindowSessionIdSchema } from "@/window_infrastructure/types";

// Every app folder lives under one throwaway base so the delete handler runs
// against real directories (its path guards resolve symlinks on disk).
const TEMP_BASE = path.join(os.tmpdir(), "dyad-tests-handler-tests");
const TEST_WINDOW_SESSION_ID = WindowSessionIdSchema.parse(
  "10000000-0000-4000-8000-000000000001",
);

const {
  browserWindowFromWebContentsMock,
  reservePreviewViewForAutomationMock,
  waitForPreviewViewMock,
  beginPreviewAutomationMock,
  previewRotateMock,
  previewBrokerStartMock,
} = vi.hoisted(() => ({
  browserWindowFromWebContentsMock: vi.fn(),
  reservePreviewViewForAutomationMock: vi.fn(),
  waitForPreviewViewMock: vi.fn(),
  beginPreviewAutomationMock: vi.fn(),
  previewRotateMock: vi.fn(),
  previewBrokerStartMock: vi.fn(),
}));

vi.mock("@/main/preview_web_contents_view", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/main/preview_web_contents_view")
  >()),
  reservePreviewViewForAutomation: reservePreviewViewForAutomationMock,
  waitForPreviewView: waitForPreviewViewMock,
  beginPreviewAutomation: beginPreviewAutomationMock,
}));

vi.mock("@/main/preview_cdp_broker", () => ({
  PreviewCdpBroker: class {
    start = previewBrokerStartMock;
    setTarget = vi.fn(async () => {});
    releaseTarget = vi.fn();
    close = vi.fn(async () => {});
    get connectionInfo() {
      return { endpoint: "ws://127.0.0.1:9999", token: "tok" };
    }
  },
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { fromWebContents: browserWindowFromWebContentsMock },
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
const canResolvePlaywrightRunnerMock = vi.hoisted(() => vi.fn());
const restoreAppFromTestBranchMock = vi.hoisted(() => vi.fn());
const createE2eTestWorkspaceMock = vi.hoisted(() => vi.fn());
const installE2eTestWorkspaceDependenciesMock = vi.hoisted(() => vi.fn());
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
    canResolvePlaywrightRunner: canResolvePlaywrightRunnerMock,
  };
});
vi.mock("../utils/neon_test_branch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../utils/neon_test_branch")>();
  return { ...actual, restoreAppFromTestBranch: restoreAppFromTestBranchMock };
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
    installE2eTestWorkspaceDependencies:
      installE2eTestWorkspaceDependenciesMock,
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
    // The clean install reproduces the real project's `@playwright/test` in the
    // sandbox, so the default is "present"; the refusal case sets it to false.
    canResolvePlaywrightRunnerMock.mockReset();
    canResolvePlaywrightRunnerMock.mockReturnValue(true);
    restoreAppFromTestBranchMock.mockReset();
    restoreAppFromTestBranchMock.mockResolvedValue(true);
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
    installE2eTestWorkspaceDependenciesMock.mockReset();
    installE2eTestWorkspaceDependenciesMock.mockResolvedValue(undefined);
    startE2eTestRuntimeMock.mockReset();
    startE2eTestRuntimeMock.mockResolvedValue({
      baseUrl: "http://127.0.0.1:49999",
      process: null,
      // `stop` reports whether the tree is CONFIRMED gone, and the caller skips
      // workspace disposal when it isn't — so a mock resolving `undefined`
      // would quietly take the "server survived" path in every case.
      stop: vi.fn().mockResolvedValue(true),
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
    browserWindowFromWebContentsMock.mockReset();
    reservePreviewViewForAutomationMock.mockReset();
    reservePreviewViewForAutomationMock.mockReturnValue(() => {});
    waitForPreviewViewMock.mockReset();
    waitForPreviewViewMock.mockResolvedValue({ ok: true });
    previewRotateMock.mockReset();
    previewRotateMock.mockReturnValue({ ok: true });
    beginPreviewAutomationMock.mockReset();
    beginPreviewAutomationMock.mockReturnValue({
      getWebContents: () => ({}),
      rotate: previewRotateMock,
      end: vi.fn(),
    });
    previewBrokerStartMock.mockReset();
    previewBrokerStartMock.mockResolvedValue(undefined);
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
    // The runner resolves the app's own Playwright CLI rather than shelling out
    // to `npx`, so a seeded app needs something for that resolution to find or
    // every run dead-ends before it can spawn anything.
    const playwrightDir = path.join(
      TEMP_BASE,
      name,
      "node_modules",
      "@playwright",
      "test",
    );
    fs.mkdirSync(playwrightDir, { recursive: true });
    fs.writeFileSync(
      path.join(playwrightDir, "package.json"),
      JSON.stringify({ name: "@playwright/test", version: "1.50.0" }),
    );
    fs.writeFileSync(path.join(playwrightDir, "cli.js"), "");
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
    it("assigns preview activation to the invoking window session", async () => {
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        infraError: { message: "setup stopped" },
        teardown: vi.fn().mockResolvedValue({ envRestored: true }),
      });
      const sender = {
        id: 101,
        isDestroyed: () => false,
        send: vi.fn(),
      };
      windowRegistry.register(sender, TEST_WINDOW_SESSION_ID);
      browserWindowFromWebContentsMock.mockReturnValue({});
      try {
        await runAppTestsWithIsolation({
          event: { sender } as any,
          appId,
          source: "agent",
          preview: true,
        });
      } finally {
        windowRegistry.unregister(sender.id);
      }

      expect(broadcastToRegisteredWindowsMock).toHaveBeenCalledWith(
        sender,
        "tests:run-state",
        expect.objectContaining({
          appId,
          source: "agent",
          state: "started",
          preview: true,
          previewOwnerWindowSessionId: TEST_WINDOW_SESSION_ID,
        }),
      );
    });

    it("releases the working tree after snapshotting the sandbox", async () => {
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      // Isolation has to succeed: the install runs after it, and this is the
      // test that the install no longer holds the user's working tree.
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });
      const requests: AppOperationRequest[] = [];
      let prepareClaimActive = false;
      const originalRun = appOperationCoordinator.run.bind(
        appOperationCoordinator,
      );
      const runSpy = vi
        .spyOn(appOperationCoordinator, "run")
        .mockImplementation((request, operation) => {
          requests.push(request);
          return originalRun(request, async () => {
            const isPrepare =
              request.operation === "prepare-e2e-test-workspace";
            if (isPrepare) prepareClaimActive = true;
            try {
              return await operation();
            } finally {
              if (isPrepare) prepareClaimActive = false;
            }
          });
        });
      installE2eTestWorkspaceDependenciesMock.mockImplementation(async () => {
        expect(prepareClaimActive).toBe(false);
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
      expect(installE2eTestWorkspaceDependenciesMock).toHaveBeenCalledOnce();
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

    it("names the leftover Supabase test user, not a database", async () => {
      // The Supabase path leaks a temporary auth user in the user's real
      // project — no sweep picks that up, and no database was involved.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "supabase-test-user" },
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

      expect(result.infraError?.message).toMatch(/temporary test user/i);
      expect(result.infraError?.message).not.toMatch(/isolated test database/i);
    });

    it("reports a server that never starts as an infra failure, not a rejection", async () => {
      // The most common failure of the whole flow: a broken `dev` script, or a
      // custom start command that ignores the port. The workspace capture and
      // the dependency install already report this shape; letting the server
      // start throw instead rejected the IPC call, so the panel recorded
      // `runError.kind: "unknown"` and the agent got "unexpected error in the
      // test infrastructure" rather than the real reason.
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
      startE2eTestRuntimeMock.mockRejectedValue(
        new DyadError(
          "The isolated test server did not become ready within 2 minutes.",
          DyadErrorKind.Precondition,
        ),
      );

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toMatch(/did not become ready/i);
      expect(result.results).toEqual([]);
    });

    it("still names the Supabase test user when Stop escapes the run stage", async () => {
      // A Stop pressed while the sandbox server is coming up throws past the
      // stage that owns `prepared`, so the outer catch has no result to read
      // the mode off. It used to fall to the generic "isolated test database"
      // wording and point a Supabase user at a database never involved.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "supabase-test-user" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: false,
        }),
      });
      const controller = new AbortController();
      startE2eTestRuntimeMock.mockImplementation(async () => {
        // Stop lands while the server is still starting.
        controller.abort();
        throw new Error("Test run stopped.");
      });

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
        externalSignal: controller.signal,
      });

      expect(result.infraError?.message).toMatch(/Test run stopped/i);
      expect(result.infraError?.message).toMatch(/temporary test user/i);
      expect(result.infraError?.message).not.toMatch(/isolated test database/i);
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
      // Resolves true: the tree is confirmed gone, which is what lets the
      // workspace be disposed rather than left for the startup sweep.
      const stop = vi.fn().mockResolvedValue(true);
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
      // No workspace was ever created, so the cleanup copy must not offer to
      // remove one — `CancellationBanner` and the panel both branch on this.
      const finished = broadcastToRegisteredWindowsMock.mock.calls
        .filter(([, channel]) => channel === "tests:run-state")
        .map(([, , payload]) => payload)
        .find((payload) => payload.state === "finished");
      expect(finished?.sandboxed).toBe(false);
    });

    it("reports a failed Git workspace capture as an infra error, not a crash", async () => {
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      createE2eTestWorkspaceMock.mockRejectedValue(
        new DyadError(
          "Could not prepare the isolated Git workspace: invalid repository.",
          DyadErrorKind.Precondition,
        ),
      );

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toMatch(/invalid repository/i);
      expect(startE2eTestRuntimeMock).not.toHaveBeenCalled();
    });

    it("reports a failed clean dependency install and disposes the workspace", async () => {
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      const dispose = vi.fn().mockResolvedValue(undefined);
      createE2eTestWorkspaceMock.mockResolvedValue({
        workspacePath: path.join(TEMP_BASE, "sandbox"),
        artifactPath: path.join(TEMP_BASE, "artifacts"),
        packageManager: "npm",
        dependencyInstallPath: path.join(TEMP_BASE, "sandbox"),
        dispose,
      });
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });
      installE2eTestWorkspaceDependenciesMock.mockRejectedValue(
        new DyadError("lockfile mismatch", DyadErrorKind.Precondition),
      );

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toMatch(/lockfile mismatch/i);
      expect(startE2eTestRuntimeMock).not.toHaveBeenCalled();
      expect(dispose).toHaveBeenCalledOnce();
    });

    it("isolates the run's data before installing its dependencies", async () => {
      // `npm ci` runs the app's lifecycle scripts, and the sandbox's
      // `.env.local` is a copy of the live one until isolation rewrites it — so
      // a `postinstall` migration installed first would run against the user's
      // real database on the way into an "isolated" run.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      const order: string[] = [];
      prepareIsolatedTestDatabaseMock.mockImplementation(async () => {
        order.push("isolate");
        return {
          isolation: { mode: "none" },
          teardown: vi.fn().mockResolvedValue({
            envRestored: true,
            remoteCleanupCompleted: true,
          }),
        };
      });
      installE2eTestWorkspaceDependenciesMock.mockImplementation(async () => {
        order.push("install");
      });

      await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(order).toEqual(["isolate", "install"]);
    });

    it("repairs a crashed recorder's env before it claims anything", async () => {
      // The repair rewrites the user's real `.env.local`, so it runs under
      // `restoreAppFromTestBranch`'s own claims (`app-path`, `provider`,
      // `runtime`, `runtime-config`) — which means before this run holds any of
      // its own, and before the snapshot copies that file into the sandbox.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true, neonTestBranchId: "leaked-branch" })
        .where(eq(apps.id, appId))
        .run();
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });
      const order: string[] = [];
      restoreAppFromTestBranchMock.mockImplementation(async () => {
        order.push("restore");
        return true;
      });
      const originalCreate =
        createE2eTestWorkspaceMock.getMockImplementation()!;
      createE2eTestWorkspaceMock.mockImplementation(async (options: any) => {
        order.push("capture");
        return originalCreate(options);
      });

      await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(order).toEqual(["restore", "capture"]);
    });

    it("leaves a cleanup-only marker to the startup sweep", async () => {
      // Nothing pointed the real app at that branch, so there is no env to put
      // back — only a remote branch the sweep retries on its own.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({
          testingEnabled: true,
          neonTestBranchId: "dyad-cleanup-only:v1:leaked",
        })
        .where(eq(apps.id, appId))
        .run();
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

      expect(restoreAppFromTestBranchMock).not.toHaveBeenCalled();
    });

    it("refuses a run whose provider changed after the snapshot", async () => {
      // The prepare stage claims neither `provider` nor `runtime-config`, so a
      // disconnect during capture leaves the sandbox holding the old
      // credentials while this stage would pick isolation for the new (absent)
      // association — `mode: "none"`, i.e. a run against real credentials it
      // believes are isolated.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true, neonProjectId: "neon-proj" })
        .where(eq(apps.id, appId))
        .run();
      // Disconnected in the gap between the capture and the run claim — the
      // window the prepare stage cannot fence, since it holds neither
      // `provider` nor `runtime-config`.
      const originalRun = appOperationCoordinator.run.bind(
        appOperationCoordinator,
      );
      const runSpy = vi
        .spyOn(appOperationCoordinator, "run")
        .mockImplementation((request, operation) => {
          if (request.operation === "run-app-tests") {
            harness.db
              .update(apps)
              .set({ neonProjectId: null })
              .where(eq(apps.id, appId))
              .run();
          }
          return originalRun(request, operation);
        });

      let result;
      try {
        result = await runAppTestsWithIsolation({
          event: { sender: {} } as any,
          appId,
          source: "panel",
        });
      } finally {
        runSpy.mockRestore();
      }

      expect(result.infraError?.message).toMatch(
        /changed while Dyad was preparing/i,
      );
      expect(prepareIsolatedTestDatabaseMock).not.toHaveBeenCalled();
      expect(startE2eTestRuntimeMock).not.toHaveBeenCalled();
    });

    it("refuses a run whose provider changed during the capture itself", async () => {
      // The copy is the ambiguous window: nothing can say which side of the
      // change the sandbox's `.env.local` landed on, so reading the row AFTER
      // it would agree with the run stage while the credentials are stale.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true, neonProjectId: "neon-proj" })
        .where(eq(apps.id, appId))
        .run();
      const dispose = vi.fn().mockResolvedValue(undefined);
      createE2eTestWorkspaceMock.mockImplementation(
        async ({ appPath }: { appPath: string }) => {
          harness.db
            .update(apps)
            .set({ neonProjectId: null })
            .where(eq(apps.id, appId))
            .run();
          return {
            workspacePath: appPath,
            artifactPath: path.join(TEMP_BASE, "artifacts"),
            dispose,
          };
        },
      );

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toMatch(
        /changed while Dyad was preparing/i,
      );
      // The capture succeeded, so its workspace is this stage's to clean up —
      // the `setupError` result deliberately carries none for the caller.
      expect(dispose).toHaveBeenCalledOnce();
      expect(prepareIsolatedTestDatabaseMock).not.toHaveBeenCalled();
    });

    it("refuses when .env.local was rewritten during the capture", async () => {
      // `setAppEnvVars` — and a user editing the file directly — change no app
      // row column, so every row comparison passes while the sandbox holds
      // credentials for a different project than the one about to receive the
      // temporary test user.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      // `getDyadAppPath` is mocked to join TEMP_BASE, and `seedApp` stores the
      // app's name as its path.
      const realAppPath = path.join(TEMP_BASE, "app");
      const sandboxPath = path.join(TEMP_BASE, "sandbox");
      fs.mkdirSync(sandboxPath, { recursive: true });
      fs.mkdirSync(realAppPath, { recursive: true });
      fs.writeFileSync(
        path.join(sandboxPath, ".env.local"),
        "SUPABASE_URL=https://old.supabase.co\n",
      );
      const dispose = vi.fn().mockResolvedValue(undefined);
      createE2eTestWorkspaceMock.mockImplementation(async () => {
        // Rewritten while the copy was in flight, so the sandbox's copy is
        // already stale by the time the capture returns.
        fs.writeFileSync(
          path.join(realAppPath, ".env.local"),
          "SUPABASE_URL=https://new.supabase.co\n",
        );
        return {
          workspacePath: sandboxPath,
          artifactPath: path.join(TEMP_BASE, "artifacts"),
          dispose,
        };
      });

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toMatch(
        /changed while Dyad was preparing/i,
      );
      expect(dispose).toHaveBeenCalledOnce();
      expect(prepareIsolatedTestDatabaseMock).not.toHaveBeenCalled();
    });

    it("refuses when the run commands changed after the snapshot", async () => {
      // The prepare stage decides whether to skip the clean install from these;
      // the run stage builds the server command from its own row. Cleared
      // between the two and the workspace has no node_modules while the runtime
      // takes the Dyad-managed `npm run dev` branch.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({
          testingEnabled: true,
          installCommand: "make deps",
          startCommand: "make serve",
        })
        .where(eq(apps.id, appId))
        .run();
      const originalRun = appOperationCoordinator.run.bind(
        appOperationCoordinator,
      );
      const runSpy = vi
        .spyOn(appOperationCoordinator, "run")
        .mockImplementation((request, operation) => {
          if (request.operation === "run-app-tests") {
            harness.db
              .update(apps)
              .set({ installCommand: null })
              .where(eq(apps.id, appId))
              .run();
          }
          return originalRun(request, operation);
        });

      let result;
      try {
        result = await runAppTestsWithIsolation({
          event: { sender: {} } as any,
          appId,
          source: "panel",
        });
      } finally {
        runSpy.mockRestore();
      }

      expect(result.infraError?.message).toMatch(
        /changed while Dyad was preparing/i,
      );
      expect(startE2eTestRuntimeMock).not.toHaveBeenCalled();
    });

    it("skips install scripts for a Supabase app, whose credentials stay live", async () => {
      // Supabase isolation is a throwaway RLS-scoped user in the REAL project
      // and never rewrites the copied env, so a `postinstall` migration would
      // run DDL against the user's live database.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true, supabaseProjectId: "sb-proj" })
        .where(eq(apps.id, appId))
        .run();
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "supabase-test-user" },
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

      expect(installE2eTestWorkspaceDependenciesMock).toHaveBeenCalledWith(
        expect.objectContaining({ ignoreScripts: true }),
      );
    });

    it("runs install scripts for a Neon app, whose env was swapped first", async () => {
      // The branch swap already happened, so `prisma generate` and friends both
      // are safe and are wanted.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true, neonProjectId: "neon-proj" })
        .where(eq(apps.id, appId))
        .run();
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "neon-branch" },
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

      expect(installE2eTestWorkspaceDependenciesMock).toHaveBeenCalledWith(
        expect.objectContaining({ ignoreScripts: false }),
      );
    });

    it("keeps the workspace when its server refused to die", async () => {
      // A survivor holds the sandbox as its cwd: deleting it leaves a live
      // server serving a deleted tree and holding a port a later run may take.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      const dispose = vi.fn().mockResolvedValue(undefined);
      createE2eTestWorkspaceMock.mockResolvedValue({
        workspacePath: path.join(TEMP_BASE, "sandbox"),
        artifactPath: path.join(TEMP_BASE, "artifacts"),
        dispose,
      });
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });
      startE2eTestRuntimeMock.mockResolvedValue({
        baseUrl: "http://127.0.0.1:49999",
        process: null,
        stop: vi.fn().mockResolvedValue(false),
      });

      await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(dispose).not.toHaveBeenCalled();
    });

    it("refuses a sandbox with no Playwright instead of failing in the CLI", async () => {
      // A custom-command app skips the clean install entirely, so nothing
      // reproduces `@playwright/test` in the sandbox. Left to the runner, that
      // surfaced as a bare resolution error and was recorded as an internal
      // Dyad exception rather than an actionable precondition.
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
      canResolvePlaywrightRunnerMock.mockReturnValue(false);

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toMatch(
        /isolated test workspace has no @playwright\/test/i,
      );
      expect(spawnStreamingMock).not.toHaveBeenCalled();
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

    it("drives the preview at the sandbox's own server, not the app's preview", async () => {
      // The two features are orthogonal: the preview panel decides where the
      // browser renders, the sandbox decides which server it points at. The
      // user watches the run in place, and what they watch is the isolated
      // copy — so the URL rotated to must be the run's, never the live app's.
      const appId = seedApp("app");
      harness.db
        .update(apps)
        .set({ testingEnabled: true })
        .where(eq(apps.id, appId))
        .run();
      // The live preview, which this run must NOT point the view at.
      runningApps.set(appId, { proxyUrl: "http://localhost:32100" } as any);
      prepareIsolatedTestDatabaseMock.mockResolvedValue({
        isolation: { mode: "none" },
        teardown: vi.fn().mockResolvedValue({
          envRestored: true,
          remoteCleanupCompleted: true,
        }),
      });
      browserWindowFromWebContentsMock.mockReturnValue({});
      const sender = { id: 401, isDestroyed: () => false, send: vi.fn() };
      windowRegistry.register(sender, TEST_WINDOW_SESSION_ID);

      try {
        await runAppTestsWithIsolation({
          event: { sender } as any,
          appId,
          source: "panel",
          preview: true,
        });
      } finally {
        windowRegistry.unregister(sender.id);
        runningApps.clear();
      }

      expect(startE2eTestRuntimeMock).toHaveBeenCalled();
      const previewArgs = spawnStreamingMock.mock.calls.at(-1)?.[0];
      expect(previewArgs.env[TEST_BASE_URL_ENV]).toBe("http://127.0.0.1:49999");
      // And the shim was routed into the REAL app before the capture, since the
      // snapshot is what carries it into the workspace the run executes from.
      expect(ensurePlaywrightBootstrapMock).toHaveBeenCalledWith(
        expect.objectContaining({ ensurePreviewShim: true }),
      );
    });

    it("waits for a live view rather than a URL nothing has navigated to", async () => {
      // The sandbox's port is one the renderer has never pointed the panel at,
      // so requiring the view to already show it would fail every preview run.
      // `rotate()` loads it before the first test instead.
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
      browserWindowFromWebContentsMock.mockReturnValue({});
      const sender = { id: 402, isDestroyed: () => false, send: vi.fn() };
      windowRegistry.register(sender, TEST_WINDOW_SESSION_ID);

      try {
        await runAppTestsWithIsolation({
          event: { sender } as any,
          appId,
          source: "panel",
          preview: true,
        });
      } finally {
        windowRegistry.unregister(sender.id);
      }

      expect(waitForPreviewViewMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({ url: expect.anything() }),
      );
    });

    it("keeps preview automation when the user opted out of the sandbox", async () => {
      // Opting out of isolation must not silently cost the ability to watch
      // tests run — that route drives the view at the normal preview instead.
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
      browserWindowFromWebContentsMock.mockReturnValue({});
      const sender = { id: 403, isDestroyed: () => false, send: vi.fn() };
      windowRegistry.register(sender, TEST_WINDOW_SESSION_ID);

      try {
        await runAppTestsWithIsolation({
          event: { sender } as any,
          appId,
          source: "panel",
          preview: true,
        });
      } finally {
        windowRegistry.unregister(sender.id);
        runningApps.clear();
      }

      expect(createE2eTestWorkspaceMock).not.toHaveBeenCalled();
      expect(beginPreviewAutomationMock).toHaveBeenCalled();
      // This route waits for the view to ALREADY show the preview's own URL,
      // because the renderer put it there.
      expect(waitForPreviewViewMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ url: "http://localhost:32100" }),
      );
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

      it("tells isolation the real runtime rather than claiming host", async () => {
        // Only the Neon branch-swap path reads this, and Neon apps are refused
        // a few lines earlier — but that is a non-local invariant. Passing the
        // truth keeps `prepareIsolatedTestDatabase`'s own host-only
        // precondition enforceable where it is written, so relaxing the
        // refusal can't silently run an env swap and `restartAppInPlace` in a
        // Docker or cloud runtime.
        const appId = seedRunningApp("app");
        prepareIsolatedTestDatabaseMock.mockResolvedValue({
          isolation: { mode: "supabase-test-user" },
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

        expect(prepareIsolatedTestDatabaseMock).toHaveBeenCalledWith(
          expect.objectContaining({ runtimeMode: "docker" }),
        );
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
