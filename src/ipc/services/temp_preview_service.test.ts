import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TempPreviewRecord } from "@/temp_preview/store";

const mocks = vi.hoisted(() => ({
  discoverBundle: vi.fn(),
  publish: vi.fn(),
  revoke: vi.fn(),
  simpleSpawn: vi.fn(),
  storeRead: vi.fn(),
  storeWrite: vi.fn(),
}));

vi.mock("@/ipc/utils/simpleSpawn", () => ({
  simpleSpawn: mocks.simpleSpawn,
}));

vi.mock("@/ipc/utils/socket_firewall", () => ({
  getPnpmMinimumReleaseAgeSupport: vi
    .fn()
    .mockResolvedValue({ available: true }),
  getPackageManagerCommandEnv: vi.fn().mockReturnValue({}),
}));

vi.mock("@/ipc/utils/package_manager_selection", () => ({
  choosePackageManagerForApp: vi.fn().mockReturnValue("npm"),
}));

vi.mock("@/main/settings", () => ({
  encrypt: vi.fn((value: string) => ({ value })),
  decrypt: vi.fn((secret: { value: string }) => secret.value),
}));

vi.mock("@/paths/paths", () => ({
  getUserDataPath: vi.fn().mockReturnValue("/tmp/dyad-test-user-data"),
}));

vi.mock("@/temp_preview/bundle", () => ({
  discoverTempPreviewBundle: mocks.discoverBundle,
}));

vi.mock("@/temp_preview/store", () => ({
  TempPreviewStore: class {
    read = mocks.storeRead;
    write = mocks.storeWrite;
  },
}));

vi.mock("@/temp_preview/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/temp_preview/client")>();
  return {
    ...actual,
    TempmdClient: class {
      publish = mocks.publish;
      revoke = mocks.revoke;
    },
  };
});

import { publishTempPreview, revokeTempPreview } from "./temp_preview_service";
import { TempmdApiError } from "@/temp_preview/client";

const roots: string[] = [];

async function createApp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dyad-temp-preview-service-"));
  roots.push(root);
  await mkdir(join(root, "dist"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { build: "vite build" } }),
    "utf8",
  );
  return root;
}

const previousRecord: TempPreviewRecord = {
  tempId: "old-temp",
  canonicalUrl: "https://old.temp.md",
  updateToken: "old-token",
  expiresAt: null,
  lastPublishedAt: "2026-08-23T00:00:00.000Z",
  state: "active",
};

const published = {
  tempId: "new-temp",
  canonicalUrl: "https://new.temp.md",
  updateToken: "new-token",
  expiresAt: "2026-08-30T00:00:00.000Z",
};

describe("temp preview service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.discoverBundle.mockResolvedValue([]);
    mocks.publish.mockResolvedValue(published);
    mocks.revoke.mockResolvedValue(undefined);
    mocks.simpleSpawn.mockResolvedValue(undefined);
    mocks.storeRead.mockResolvedValue(null);
    mocks.storeWrite.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("best-effort revokes a new preview when local persistence fails", async () => {
    const appPath = await createApp();
    const persistenceError = new Error("disk full");
    mocks.storeWrite.mockRejectedValueOnce(persistenceError);

    await expect(
      publishTempPreview({ appId: 7, appPath, appName: "Demo" }),
    ).rejects.toBe(persistenceError);
    expect(mocks.revoke).toHaveBeenCalledWith(published);
  });

  it("does not revoke an existing preview when an update cannot be persisted", async () => {
    const appPath = await createApp();
    mocks.storeRead.mockResolvedValue(previousRecord);
    mocks.publish.mockResolvedValue({
      ...published,
      tempId: previousRecord.tempId,
      canonicalUrl: previousRecord.canonicalUrl,
    });
    mocks.storeWrite.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      publishTempPreview({ appId: 7, appPath, appName: "Demo" }),
    ).rejects.toThrow("disk full");
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("retires a stale connection and creates a fresh preview", async () => {
    const appPath = await createApp();
    mocks.storeRead.mockResolvedValue(previousRecord);
    mocks.publish
      .mockRejectedValueOnce(new TempmdApiError("gone", 410))
      .mockResolvedValueOnce(published);

    await expect(
      publishTempPreview({ appId: 7, appPath, appName: "Demo" }),
    ).resolves.toMatchObject({
      state: "active",
      canonicalUrl: published.canonicalUrl,
    });
    expect(mocks.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        previous: expect.objectContaining({ tempId: "old-temp" }),
      }),
    );
    expect(mocks.publish).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({ previous: expect.anything() }),
    );
    expect(mocks.storeWrite).toHaveBeenNthCalledWith(
      1,
      7,
      expect.objectContaining({ state: "revoked", updateToken: undefined }),
    );
  });

  it("reconciles an already-missing remote preview as revoked", async () => {
    mocks.storeRead.mockResolvedValue(previousRecord);
    mocks.revoke.mockRejectedValue(new TempmdApiError("not found", 404));

    await expect(revokeTempPreview(7)).resolves.toMatchObject({
      state: "revoked",
    });
    expect(mocks.storeWrite).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ state: "revoked", updateToken: undefined }),
    );
  });
});
