import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DyadErrorKind } from "@/errors/dyad_error";
import { apps } from "@/db/schema";
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

const gitRemoveMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../utils/git_utils", () => ({
  gitAdd: vi.fn(async () => {}),
  gitRemove: gitRemoveMock,
}));

const queueCloudSandboxSnapshotSyncMock = vi.hoisted(() => vi.fn());
vi.mock("../utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync: queueCloudSandboxSnapshotSyncMock,
}));

// Imported after the mocks so the handler module picks them up.
const { registerTestsHandlers } = await import("./tests_handlers");

describe("tests:delete", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEMP_BASE, { recursive: true });
    gitRemoveMock.mockClear();
    queueCloudSandboxSnapshotSyncMock.mockClear();
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

  it("deletes the spec file and stages the removal in git", async () => {
    const appId = seedApp("app");
    const specPath = writeSpec("app", "e2e-tests/signup.spec.ts");

    const result = await harness.invokeHandler<{ file: string }>(
      "tests:delete",
      { appId, testFile: "e2e-tests/signup.spec.ts" },
    );

    expect(result).toEqual({ file: "e2e-tests/signup.spec.ts" });
    expect(fs.existsSync(specPath)).toBe(false);
    expect(gitRemoveMock).toHaveBeenCalledWith({
      path: path.join(TEMP_BASE, "app"),
      filepath: "e2e-tests/signup.spec.ts",
    });
    expect(queueCloudSandboxSnapshotSyncMock).toHaveBeenCalledWith({
      appId,
      deletedPaths: ["e2e-tests/signup.spec.ts"],
    });
  });

  it("still reports success when the file isn't tracked by git", async () => {
    const appId = seedApp("app");
    const specPath = writeSpec("app", "e2e-tests/nested/checkout.spec.ts");
    gitRemoveMock.mockRejectedValueOnce(new Error("not tracked"));

    const result = await harness.invokeHandler<{ file: string }>(
      "tests:delete",
      { appId, testFile: "e2e-tests/nested/checkout.spec.ts" },
    );

    expect(result).toEqual({ file: "e2e-tests/nested/checkout.spec.ts" });
    expect(fs.existsSync(specPath)).toBe(false);
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
    expect(gitRemoveMock).not.toHaveBeenCalled();
  });

  it("reports a missing spec as not found", async () => {
    const appId = seedApp("app");

    await expect(
      harness.invokeHandler("tests:delete", {
        appId,
        testFile: "e2e-tests/gone.spec.ts",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });

    expect(gitRemoveMock).not.toHaveBeenCalled();
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
