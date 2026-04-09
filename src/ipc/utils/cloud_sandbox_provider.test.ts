import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { gitIsIgnoredIsoMock } = vi.hoisted(() => ({
  gitIsIgnoredIsoMock: vi.fn(),
}));

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

vi.mock("./git_utils", () => ({
  gitIsIgnoredIso: gitIsIgnoredIsoMock,
}));

import {
  createCloudSandbox,
  buildCloudSandboxFileMap,
  reconcileCloudSandboxes,
  registerRunningCloudSandbox,
  setCloudSandboxSyncUpdateListener,
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
    gitIsIgnoredIsoMock.mockReset();
    gitIsIgnoredIsoMock.mockResolvedValue(false);
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
    setCloudSandboxSyncUpdateListener(undefined);
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

  it("excludes gitignored paths, keeps root env files, and skips symlinks", async () => {
    await fs.writeFile(
      path.join(appPath, "visible.ts"),
      "export const ok = true;",
    );
    await fs.writeFile(path.join(appPath, ".env"), "ROOT_ENV=1");
    await fs.writeFile(path.join(appPath, ".env.local"), "ROOT_ENV_LOCAL=1");
    await fs.writeFile(path.join(appPath, "ignored.ts"), "ignored");
    await fs.mkdir(path.join(appPath, "ignored-dir"));
    await fs.writeFile(
      path.join(appPath, "ignored-dir", "secret.ts"),
      "secret",
    );
    await fs.mkdir(path.join(appPath, "nested"));
    await fs.writeFile(path.join(appPath, "nested", ".env.local"), "nested");
    await fs.writeFile(path.join(appPath, "symlink-target.ts"), "outside");
    await fs.symlink(
      path.join(appPath, "symlink-target.ts"),
      path.join(appPath, "linked.ts"),
    );

    gitIsIgnoredIsoMock.mockImplementation(async ({ filepath }) => {
      return (
        filepath === ".env" ||
        filepath === ".env.local" ||
        filepath === "ignored.ts" ||
        filepath === "ignored-dir" ||
        filepath === "nested/.env.local"
      );
    });

    await expect(buildCloudSandboxFileMap(appPath)).resolves.toEqual({
      ".env": "ROOT_ENV=1",
      ".env.local": "ROOT_ENV_LOCAL=1",
      "symlink-target.ts": "outside",
      "visible.ts": "export const ok = true;",
    });
  });

  it("treats ignored and symlinked changed paths as deletions during incremental sync", async () => {
    await fs.writeFile(path.join(appPath, "changed.ts"), "updated");
    await fs.writeFile(path.join(appPath, ".env.local"), "SAFE_ENV=1");
    await fs.writeFile(path.join(appPath, "ignored.ts"), "ignored");
    await fs.writeFile(path.join(appPath, "symlink-target.ts"), "target");
    await fs.symlink(
      path.join(appPath, "symlink-target.ts"),
      path.join(appPath, "linked.ts"),
    );

    gitIsIgnoredIsoMock.mockImplementation(async ({ filepath }) => {
      return filepath === ".env.local" || filepath === "ignored.ts";
    });

    await syncCloudSandboxDirtyPaths({
      appId: 1,
      changedPaths: ["changed.ts", ".env.local", "ignored.ts", "linked.ts"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      files: {
        ".env.local": "SAFE_ENV=1",
        "changed.ts": "updated",
      },
      replaceAll: false,
      deletedFiles: ["ignored.ts", "linked.ts"],
    });
  });

  it("promotes gitignore changes to a full snapshot sync", async () => {
    await fs.writeFile(path.join(appPath, ".gitignore"), "dist\n");
    await fs.writeFile(path.join(appPath, "index.ts"), "console.log('ok');");

    await syncCloudSandboxDirtyPaths({
      appId: 1,
      changedPaths: [".gitignore"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      files: {
        ".gitignore": "dist\n",
        "index.ts": "console.log('ok');",
      },
      replaceAll: true,
      deletedFiles: [],
    });
  });

  it("notifies listeners when syncs fail and later recover", async () => {
    const syncUpdateListener = vi.fn();
    setCloudSandboxSyncUpdateListener(syncUpdateListener);
    await fs.writeFile(path.join(appPath, "src.ts"), "console.log('hi');");

    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(
      syncCloudSandboxDirtyPaths({
        appId: 1,
        changedPaths: ["src.ts"],
      }),
    ).rejects.toThrow("network down");

    expect(syncUpdateListener).toHaveBeenCalledWith({
      appId: 1,
      errorMessage: "Cloud sandbox sync failed: network down",
    });

    await syncCloudSandboxDirtyPaths({
      appId: 1,
      changedPaths: ["src.ts"],
    });

    expect(syncUpdateListener).toHaveBeenLastCalledWith({
      appId: 1,
      errorMessage: null,
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
          previewAuthToken: "preview-auth-token",
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
