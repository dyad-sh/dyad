import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  createCloudSandbox,
  reconcileCloudSandboxes,
  registerRunningCloudSandbox,
  syncCloudSandboxDirtyPaths,
  stopCloudSandboxFileSync,
  syncCloudSandboxSnapshot,
  unregisterRunningCloudSandbox,
  uploadCloudSandboxFiles,
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

describe("cloud_sandbox_provider sandbox creation", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let fetchSpy: { mockRestore: () => void };

  beforeEach(() => {
    fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          sandboxId: "sandbox-1",
          previewUrl: "https://preview.example.test",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("uses default commands when custom commands are missing", async () => {
    await createCloudSandbox({
      appId: 42,
      appPath: "/tmp/app",
      installCommand: null,
      startCommand: undefined,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      appId: 42,
      appPath: "/tmp/app",
      installCommand: "pnpm install",
      startCommand: "pnpm run dev",
    });
  });

  it("preserves explicit custom commands after trimming", async () => {
    await createCloudSandbox({
      appId: 42,
      appPath: "/tmp/app",
      installCommand: "  npm ci  ",
      startCommand: "  npm run dev -- --port 3000  ",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      appId: 42,
      appPath: "/tmp/app",
      installCommand: "npm ci",
      startCommand: "npm run dev -- --port 3000",
    });
  });

  it("throws when the engine response is missing sandboxId", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          previewUrl: "https://preview.example.test",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      createCloudSandbox({
        appId: 42,
        appPath: "/tmp/app",
      }),
    ).rejects.toThrow(
      "Invalid create sandbox response from cloud sandbox API:",
    );
  });
});

describe("cloud_sandbox_provider response validation", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let fetchSpy: { mockRestore: () => void };

  beforeEach(() => {
    fetchMock = vi.fn();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("throws when upload files response has an invalid previewUrl", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          previewUrl: 123,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      uploadCloudSandboxFiles({
        sandboxId: "sandbox-1",
        files: {},
      }),
    ).rejects.toThrow(
      "Invalid upload sandbox files response from cloud sandbox API:",
    );
  });

  it("throws when reconcile response has invalid sandbox ids", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          reconciledSandboxIds: ["sandbox-1", ""],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(reconcileCloudSandboxes()).rejects.toThrow(
      "Invalid reconcile sandboxes response from cloud sandbox API:",
    );
  });
});
