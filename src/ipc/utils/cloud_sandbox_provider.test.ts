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
  CloudSandboxApiError,
  createCloudSandbox,
  buildCloudSandboxFileMap,
  queueCloudSandboxSnapshotSync,
  reconcileCloudSandboxes,
  registerRunningCloudSandbox,
  setCloudSandboxSyncUpdateListener,
  syncCloudSandboxDirtyPaths,
  stopCloudSandboxFileSync,
  syncCloudSandboxSnapshot,
  unregisterRunningCloudSandbox,
  uploadCloudSandboxFiles,
} from "./cloud_sandbox_provider";

type ParsedMultipartUpload = {
  manifest: {
    replaceAll: boolean;
    deletedFiles: string[];
    files: Array<{
      path: string;
      fieldName: string;
    }>;
  };
  files: Record<string, Buffer>;
};

async function parseMultipartUpload(
  init: RequestInit | undefined,
): Promise<ParsedMultipartUpload> {
  const request = new Request("https://dyad.test/upload", {
    method: "POST",
    body: init?.body as BodyInit,
    headers: init?.headers,
  });
  const formData = await request.formData();
  const manifestValue = formData.get("manifest");

  if (typeof manifestValue !== "string") {
    throw new Error("Expected manifest form field.");
  }

  const manifest = JSON.parse(
    manifestValue,
  ) as ParsedMultipartUpload["manifest"];
  const files = Object.fromEntries(
    await Promise.all(
      manifest.files.map(async ({ path, fieldName }) => {
        const filePart = formData.get(fieldName);
        if (!(filePart instanceof File)) {
          throw new Error(`Expected file part for ${fieldName}.`);
        }

        return [path, Buffer.from(await filePart.arrayBuffer())] as const;
      }),
    ),
  );

  return {
    manifest,
    files,
  };
}

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
    const upload = await parseMultipartUpload(init);
    expect(upload.manifest).toEqual({
      replaceAll: false,
      deletedFiles: [],
      files: [
        {
          path: "src.ts",
          fieldName: "file_0",
        },
      ],
    });
    expect(upload.files).toEqual({
      "src.ts": Buffer.from("console.log('hi');"),
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
    const upload = await parseMultipartUpload(init);
    expect(upload.manifest).toEqual({
      replaceAll: false,
      deletedFiles: ["old.ts"],
      files: [
        {
          path: "keep.ts",
          fieldName: "file_0",
        },
      ],
    });
    expect(upload.files).toEqual({
      "keep.ts": Buffer.from("updated"),
    });
  });

  it("keeps full snapshot sync available for reconcile paths", async () => {
    await fs.writeFile(path.join(appPath, "a.ts"), "A");
    await fs.mkdir(path.join(appPath, "nested"));
    await fs.writeFile(path.join(appPath, "nested", "b.ts"), "B");

    await syncCloudSandboxSnapshot({ appId: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const upload = await parseMultipartUpload(init);
    expect(upload.manifest).toEqual({
      replaceAll: true,
      deletedFiles: [],
      files: [
        {
          path: "a.ts",
          fieldName: "file_0",
        },
        {
          path: "nested/b.ts",
          fieldName: "file_1",
        },
      ],
    });
    expect(upload.files).toEqual({
      "a.ts": Buffer.from("A"),
      "nested/b.ts": Buffer.from("B"),
    });
  });

  it("uploads binary files without utf-8 transcoding", async () => {
    const originalBytes = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x41, 0x42]);
    await fs.writeFile(path.join(appPath, "assets.bin"), originalBytes);

    await syncCloudSandboxDirtyPaths({
      appId: 1,
      changedPaths: ["assets.bin"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const upload = await parseMultipartUpload(init);

    expect(upload.manifest).toEqual({
      replaceAll: false,
      deletedFiles: [],
      files: [
        {
          path: "assets.bin",
          fieldName: "file_0",
        },
      ],
    });
    expect(upload.files["assets.bin"]).toEqual(originalBytes);
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
      ".env": Buffer.from("ROOT_ENV=1"),
      ".env.local": Buffer.from("ROOT_ENV_LOCAL=1"),
      "symlink-target.ts": Buffer.from("outside"),
      "visible.ts": Buffer.from("export const ok = true;"),
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
    const upload = await parseMultipartUpload(init);
    expect(upload.manifest).toEqual({
      replaceAll: false,
      deletedFiles: ["ignored.ts", "linked.ts"],
      files: [
        {
          path: ".env.local",
          fieldName: "file_0",
        },
        {
          path: "changed.ts",
          fieldName: "file_1",
        },
      ],
    });
    expect(upload.files).toEqual({
      ".env.local": Buffer.from("SAFE_ENV=1"),
      "changed.ts": Buffer.from("updated"),
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
    const upload = await parseMultipartUpload(init);
    expect(upload.manifest).toEqual({
      replaceAll: true,
      deletedFiles: [],
      files: [
        {
          path: ".gitignore",
          fieldName: "file_0",
        },
        {
          path: "index.ts",
          fieldName: "file_1",
        },
      ],
    });
    expect(upload.files).toEqual({
      ".gitignore": Buffer.from("dist\n"),
      "index.ts": Buffer.from("console.log('ok');"),
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

  it("does not drop queued changes that arrive while an upload is in flight", async () => {
    vi.useRealTimers();

    const makeUploadResponse = () =>
      new Response(
        JSON.stringify({
          previewUrl: "https://preview.example.test",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    await fs.writeFile(path.join(appPath, "first.ts"), "first");
    await fs.writeFile(path.join(appPath, "second.ts"), "second");

    let resolveFirstUpload: ((response: Response) => void) | undefined;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirstUpload = resolve;
          }),
      )
      .mockImplementation(async () => makeUploadResponse());

    queueCloudSandboxSnapshotSync({
      appId: 1,
      changedPaths: ["first.ts"],
    });
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    queueCloudSandboxSnapshotSync({
      appId: 1,
      changedPaths: ["second.ts"],
    });

    resolveFirstUpload?.(makeUploadResponse());
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [, secondInit] = fetchMock.mock.calls[1];
    const upload = await parseMultipartUpload(secondInit);
    expect(upload.manifest).toEqual({
      replaceAll: false,
      deletedFiles: [],
      files: [
        {
          path: "second.ts",
          fieldName: "file_0",
        },
      ],
    });
    expect(upload.files).toEqual({
      "second.ts": Buffer.from("second"),
    });
  });

  it("notifies listeners when queued sync uploads fail and later recover", async () => {
    vi.useRealTimers();

    const syncUpdateListener = vi.fn();
    setCloudSandboxSyncUpdateListener(syncUpdateListener);
    await fs.writeFile(path.join(appPath, "src.ts"), "console.log('hi');");

    fetchMock.mockRejectedValueOnce(new Error("network down"));

    queueCloudSandboxSnapshotSync({
      appId: 1,
      changedPaths: ["src.ts"],
    });

    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(syncUpdateListener).toHaveBeenCalledWith({
      appId: 1,
      errorMessage: "Cloud sandbox sync failed: network down",
    });

    queueCloudSandboxSnapshotSync({
      appId: 1,
      changedPaths: ["src.ts"],
    });

    await new Promise((resolve) => setTimeout(resolve, 350));

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

  it("treats reconcile 404s as an unsupported endpoint and ignores them", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(reconcileCloudSandboxes()).resolves.toEqual([]);
  });

  it("does not swallow non-404 reconcile failures", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: "Upstream mentioned 404 while returning a 503",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(reconcileCloudSandboxes()).rejects.toThrow(
      "Upstream mentioned 404 while returning a 503",
    );
  });

  it("uses status-based messages instead of surfacing raw error bodies", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>upstream exploded</html>", {
        status: 503,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const error = await uploadCloudSandboxFiles({
      sandboxId: "sandbox-1",
      files: {},
    }).catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(CloudSandboxApiError);
    expect(error).toMatchObject({
      message:
        "Dyad’s cloud sandbox service is temporarily unavailable. Please try again.",
      status: 503,
    });
  });
});
