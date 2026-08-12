import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { DyadErrorKind } from "@/errors/dyad_error";
import type { RemoveFileAndCommitResult } from "../services/git_service";
import { apps } from "@/db/schema";
import { appOperationCoordinator } from "../services/app_operation_coordinator";
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

    it("reports an unrestored test-run environment", async () => {
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
        teardown: vi.fn().mockResolvedValue({ envRestored: false }),
      });

      const result = await runAppTestsWithIsolation({
        event: { sender: {} } as any,
        appId,
        source: "panel",
      });

      expect(result.infraError?.message).toMatch(/real database settings/i);
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
