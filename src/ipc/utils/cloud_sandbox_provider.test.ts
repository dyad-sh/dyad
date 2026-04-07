import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    providerSettings: {
      auto: {
        apiKey: {
          value: "test-key",
        },
      },
    },
  }),
}));

vi.mock("./test_utils", () => ({
  IS_TEST_BUILD: true,
}));

import {
  registerRunningCloudSandbox,
  syncCloudSandboxDirtyPaths,
  stopCloudSandboxFileSync,
  syncCloudSandboxSnapshot,
  unregisterRunningCloudSandbox,
} from "./cloud_sandbox_provider";

describe("cloud_sandbox_provider incremental sync", () => {
  let appPath: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  let fetchSpy: { mockRestore: () => void };

  beforeEach(async () => {
    vi.useFakeTimers();
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-cloud-sync-"));
    fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          previewUrl: "https://preview.example.test",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
    registerRunningCloudSandbox({
      appId: 1,
      appPath,
      sandboxId: "sandbox-1",
    });
  });

  afterEach(async () => {
    stopCloudSandboxFileSync(1);
    unregisterRunningCloudSandbox({ appId: 1, appPath });
    fetchSpy.mockRestore();
    vi.useRealTimers();
    await fs.rm(appPath, { recursive: true, force: true });
  });

  it("uploads only dirty changed files for incremental syncs", async () => {
    await fs.writeFile(path.join(appPath, "src.ts"), "console.log('hi');");

    await syncCloudSandboxDirtyPaths({
      appId: 1,
      changedPaths: ["src.ts"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      files: {
        "src.ts": "console.log('hi');",
      },
      replaceAll: false,
      deletedFiles: [],
    });
  });

  it("uploads changed and deleted paths together", async () => {
    await fs.writeFile(path.join(appPath, "keep.ts"), "updated");
    await fs.writeFile(path.join(appPath, "old.ts"), "obsolete");
    await fs.unlink(path.join(appPath, "old.ts"));

    await syncCloudSandboxDirtyPaths({
      appId: 1,
      changedPaths: ["keep.ts"],
      deletedPaths: ["old.ts"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      files: {
        "keep.ts": "updated",
      },
      replaceAll: false,
      deletedFiles: ["old.ts"],
    });
  });

  it("keeps full snapshot sync available for reconcile paths", async () => {
    await fs.writeFile(path.join(appPath, "a.ts"), "A");
    await fs.mkdir(path.join(appPath, "nested"));
    await fs.writeFile(path.join(appPath, "nested", "b.ts"), "B");

    await syncCloudSandboxSnapshot({ appId: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      files: {
        "a.ts": "A",
        "nested/b.ts": "B",
      },
      replaceAll: true,
      deletedFiles: [],
    });
  });
});
