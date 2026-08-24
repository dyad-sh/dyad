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
  storeRemove: vi.fn(),
  storeMarkPendingDeletion: vi.fn(),
  storeClearPendingDeletion: vi.fn(),
  storeListPendingDeletionAppIds: vi.fn(),
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

vi.mock("@/temp_preview/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/temp_preview/store")>();
  return {
    ...actual,
    TempPreviewStore: class {
      read = mocks.storeRead;
      remove = mocks.storeRemove;
      markPendingDeletion = mocks.storeMarkPendingDeletion;
      clearPendingDeletion = mocks.storeClearPendingDeletion;
      listPendingDeletionAppIds = mocks.storeListPendingDeletionAppIds;
      write = mocks.storeWrite;
    },
  };
});

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

import {
  clearTempPreviewAppDeletionMarker,
  deleteTempPreviewForApp,
  getTempPreviewStatus,
  listPendingTempPreviewDeletionAppIds,
  markTempPreviewForAppDeletion,
  publishTempPreview,
  revokeTempPreview,
} from "./temp_preview_service";
import { TempmdApiError } from "@/temp_preview/client";
import { TempPreviewStoreUnreadableError } from "@/temp_preview/store";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

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
    mocks.storeRemove.mockResolvedValue(undefined);
    mocks.storeMarkPendingDeletion.mockResolvedValue(false);
    mocks.storeClearPendingDeletion.mockResolvedValue(undefined);
    mocks.storeListPendingDeletionAppIds.mockResolvedValue([]);
    mocks.storeWrite.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("sanitizes deletion-marker store failures", async () => {
    const operations = [
      {
        storeMethod: mocks.storeMarkPendingDeletion,
        invoke: () => markTempPreviewForAppDeletion(7),
      },
      {
        storeMethod: mocks.storeClearPendingDeletion,
        invoke: () => clearTempPreviewAppDeletionMarker(7),
      },
      {
        storeMethod: mocks.storeListPendingDeletionAppIds,
        invoke: () => listPendingTempPreviewDeletionAppIds(),
      },
    ];

    for (const { storeMethod, invoke } of operations) {
      storeMethod.mockRejectedValueOnce(
        Object.assign(
          new Error(
            "EACCES: permission denied, open '/Users/alice/Library/Application Support/Dyad/temp-preview-connections.json'",
          ),
          { code: "EACCES" },
        ),
      );

      const error = await invoke().catch((caught) => caught);

      expect(error).toMatchObject({
        kind: DyadErrorKind.Unknown,
        cause: undefined,
      });
      expect(error.message).not.toMatch(
        /alice|Application Support|temp-preview-connections/,
      );
    }
  });

  it("best-effort revokes a new preview when local persistence fails", async () => {
    const appPath = await createApp();
    const persistenceError = new Error("disk full");
    mocks.storeWrite.mockRejectedValueOnce(persistenceError);

    await expect(
      publishTempPreview({ appId: 7, appPath, appName: "Demo" }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Unknown,
      message: "disk full",
      cause: undefined,
    });
    expect(mocks.revoke).toHaveBeenCalledWith(published);
  });

  it("derives the seven-day expiry when temp.md omits it", async () => {
    const appPath = await createApp();
    mocks.publish.mockResolvedValueOnce({ ...published, expiresAt: null });

    const status = await publishTempPreview({
      appId: 7,
      appPath,
      appName: "Demo",
    });

    expect(status).toMatchObject({ state: "active" });
    const storedRecord = mocks.storeWrite.mock.calls[0][1];
    expect(status.expiresAt).toBe(storedRecord.expiresAt);
    expect(Date.parse(storedRecord.expiresAt)).toBe(
      Date.parse(storedRecord.lastPublishedAt) + 7 * 24 * 60 * 60 * 1_000,
    );
  });

  it("expires a stored preview seven days after publish when expiry is missing", async () => {
    mocks.storeRead.mockResolvedValueOnce({
      ...previousRecord,
      lastPublishedAt: new Date(
        Date.now() - 8 * 24 * 60 * 60 * 1_000,
      ).toISOString(),
    });

    await expect(getTempPreviewStatus(7)).resolves.toMatchObject({
      state: "expired",
      expiresAt: expect.any(String),
    });
  });

  it("sanitizes build failures before returning them", async () => {
    const appPath = await createApp();
    mocks.simpleSpawn.mockRejectedValue(
      new DyadError(
        "Build failed in /Users/alice/Client-App with API_KEY=private-value",
        DyadErrorKind.External,
      ),
    );

    const error = await publishTempPreview({
      appId: 7,
      appPath,
      appName: "Demo",
    }).catch((caught) => caught);

    expect(error).toMatchObject({
      kind: DyadErrorKind.External,
      cause: undefined,
    });
    expect(error.message).not.toMatch(/alice|private-value/);
    expect(mocks.simpleSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ logOutput: false }),
    );
  });

  it("sanitizes temp.md failures before returning them", async () => {
    const appPath = await createApp();
    mocks.publish.mockRejectedValue(
      new TempmdApiError(
        "Upload failed at https://private.internal/path?token=secret-value",
        500,
        undefined,
        "session",
      ),
    );

    await expect(
      publishTempPreview({ appId: 7, appPath, appName: "Demo" }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      cause: undefined,
      message: expect.not.stringMatching(/private\.internal|secret-value/),
    });
  });

  it("surfaces an unreadable capability without treating the preview as absent", async () => {
    mocks.storeRead.mockRejectedValue(
      new TempPreviewStoreUnreadableError(7, {
        cause: new Error("keychain unavailable"),
      }),
    );

    await expect(getTempPreviewStatus(7)).rejects.toMatchObject({
      message: expect.stringContaining(
        "encrypted capability has been preserved",
      ),
    });
  });

  it("revokes an update when its replacement capability cannot be persisted", async () => {
    const appPath = await createApp();
    mocks.storeRead.mockResolvedValue(previousRecord);
    const updated = {
      ...published,
      tempId: previousRecord.tempId,
      canonicalUrl: previousRecord.canonicalUrl,
    };
    mocks.publish.mockResolvedValue(updated);
    mocks.storeWrite.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      publishTempPreview({ appId: 7, appPath, appName: "Demo" }),
    ).rejects.toThrow("disk full");
    expect(mocks.revoke).toHaveBeenCalledWith(updated);
  });

  it("keeps a same-capability update recoverable when renewed metadata cannot be persisted", async () => {
    const appPath = await createApp();
    mocks.storeRead.mockResolvedValue(previousRecord);
    const updated = {
      ...published,
      tempId: previousRecord.tempId,
      canonicalUrl: previousRecord.canonicalUrl,
      updateToken: previousRecord.updateToken,
    };
    mocks.publish.mockResolvedValue(updated);
    mocks.storeWrite.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      publishTempPreview({ appId: 7, appPath, appName: "Demo" }),
    ).rejects.toThrow("disk full");
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("reuses an expired stored capability for remote reconciliation", async () => {
    const appPath = await createApp();
    const expiredRecord = {
      ...previousRecord,
      expiresAt: "2026-08-01T00:00:00.000Z",
    };
    mocks.storeRead.mockResolvedValue(expiredRecord);

    await publishTempPreview({ appId: 7, appPath, appName: "Demo" });

    expect(mocks.publish).toHaveBeenCalledWith({
      files: [],
      title: "Demo",
      previous: {
        tempId: expiredRecord.tempId,
        canonicalUrl: expiredRecord.canonicalUrl,
        updateToken: expiredRecord.updateToken,
        expiresAt: expiredRecord.expiresAt,
      },
    });
  });

  it("retires a stale connection and creates a fresh preview", async () => {
    const appPath = await createApp();
    mocks.storeRead.mockResolvedValue(previousRecord);
    mocks.publish
      .mockRejectedValueOnce(
        new TempmdApiError("gone", 410, undefined, "session"),
      )
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

  it("does not create a second preview when update finalization fails", async () => {
    const appPath = await createApp();
    mocks.storeRead.mockResolvedValue(previousRecord);
    mocks.publish.mockRejectedValue(
      new TempmdApiError("finalize failed", 410, undefined, "finalize"),
    );

    await expect(
      publishTempPreview({ appId: 7, appPath, appName: "Demo" }),
    ).rejects.toThrow("finalize failed");
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.storeWrite).not.toHaveBeenCalled();
  });

  it("reconciles an already-revoked remote capability locally", async () => {
    mocks.storeRead.mockResolvedValue(previousRecord);
    mocks.revoke.mockRejectedValue(
      new TempmdApiError("revoked", 403, undefined, "revoke"),
    );

    await expect(revokeTempPreview(7)).resolves.toMatchObject({
      state: "revoked",
    });
    expect(mocks.storeWrite).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ state: "revoked", updateToken: undefined }),
    );
  });

  it("revokes and removes an active preview before app deletion", async () => {
    mocks.storeRead.mockResolvedValue(previousRecord);

    await expect(deleteTempPreviewForApp(7)).resolves.toBeUndefined();

    expect(mocks.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ tempId: previousRecord.tempId }),
    );
    expect(mocks.storeRemove).toHaveBeenCalledWith(7);
    expect(mocks.storeRemove.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.revoke.mock.invocationCallOrder[0],
    );
  });

  it("does not remove deletion state when remote revocation fails", async () => {
    mocks.storeRead.mockResolvedValue(previousRecord);
    mocks.revoke.mockRejectedValue(
      new TempmdApiError("unavailable", 503, undefined, "revoke"),
    );

    await expect(deleteTempPreviewForApp(7)).rejects.toThrow("unavailable");
    expect(mocks.storeRemove).not.toHaveBeenCalled();
  });

  it("does not remove an undecryptable capability during app deletion", async () => {
    mocks.storeRead.mockRejectedValue(
      new TempPreviewStoreUnreadableError(7, {
        cause: new Error("keychain unavailable"),
      }),
    );

    await expect(deleteTempPreviewForApp(7)).rejects.toMatchObject({
      message: expect.stringContaining(
        "encrypted capability has been preserved",
      ),
    });
    expect(mocks.storeRemove).not.toHaveBeenCalled();
  });

  it("removes deletion state when the remote preview is already gone", async () => {
    mocks.storeRead.mockResolvedValue(previousRecord);
    mocks.revoke.mockRejectedValue(
      new TempmdApiError("gone", 410, undefined, "revoke"),
    );

    await expect(deleteTempPreviewForApp(7)).resolves.toBeUndefined();
    expect(mocks.storeRemove).toHaveBeenCalledWith(7);
  });
});
