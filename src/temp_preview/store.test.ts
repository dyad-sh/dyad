import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: mocks.warn }) },
}));

import { TempPreviewStore, TempPreviewStoreUnreadableError } from "./store";

const storeRoots: string[] = [];

async function createStoreRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dyad-temp-preview-store-"));
  storeRoots.push(root);
  return root;
}

describe("TempPreviewStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(
      storeRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("persists an encoded update capability and returns its decoded value", async () => {
    const root = await createStoreRoot();
    const filePath = join(root, "previews.json");
    const store = new TempPreviewStore(filePath, {
      encode: (token) => ({ value: `encrypted:${token}` }),
      decode: (secret) => secret.value.replace(/^encrypted:/, ""),
    });

    await store.write(7, {
      tempId: "temp-1",
      canonicalUrl: "https://example.temp.md",
      updateToken: "update-secret",
      expiresAt: "2026-08-30T00:00:00.000Z",
      lastPublishedAt: "2026-08-23T00:00:00.000Z",
      state: "active",
    });

    await expect(store.read(7)).resolves.toMatchObject({
      updateToken: "update-secret",
    });
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("encrypted:update-secret");
    expect(contents).not.toContain('"value": "update-secret"');
  });

  it("backs up a malformed store and recovers with an empty store", async () => {
    const root = await createStoreRoot();
    const filePath = join(root, "previews.json");
    await writeFile(filePath, "not-json", "utf8");
    const store = new TempPreviewStore(filePath, {
      encode: (token) => ({ value: `encrypted:${token}` }),
      decode: (secret) => secret.value.replace(/^encrypted:/, ""),
    });

    await expect(store.read(7)).resolves.toBeNull();
    expect(await readdir(root)).toEqual(
      expect.arrayContaining([
        "previews.json",
        expect.stringMatching(/^previews\.json\.corrupt-/),
      ]),
    );
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown app records"),
    );

    await store.write(7, {
      tempId: "temp-2",
      canonicalUrl: "https://recovered.temp.md",
      updateToken: "update-secret",
      expiresAt: null,
      lastPublishedAt: "2026-08-23T00:00:00.000Z",
      state: "active",
    });
    await expect(store.read(7)).resolves.toMatchObject({ tempId: "temp-2" });
  });

  it("salvages valid app records when one record is malformed", async () => {
    const root = await createStoreRoot();
    const filePath = join(root, "previews.json");
    const store = new TempPreviewStore(filePath, {
      encode: (token) => ({ value: `encrypted:${token}` }),
      decode: (secret) => secret.value.replace(/^encrypted:/, ""),
    });
    await store.write(7, {
      tempId: "temp-valid",
      canonicalUrl: "https://valid.temp.md",
      updateToken: "update-secret",
      expiresAt: null,
      lastPublishedAt: "2026-08-23T00:00:00.000Z",
      state: "active",
    });
    const contents = JSON.parse(await readFile(filePath, "utf8"));
    contents.records[8] = { invalid: true };
    await writeFile(filePath, JSON.stringify(contents), "utf8");

    await expect(store.read(7)).resolves.toMatchObject({
      tempId: "temp-valid",
      updateToken: "update-secret",
    });
    await expect(store.read(8)).resolves.toBeNull();
    const repaired = JSON.parse(await readFile(filePath, "utf8"));
    expect(Object.keys(repaired.records)).toEqual(["7"]);
    expect(await readdir(root)).toEqual(
      expect.arrayContaining([
        "previews.json",
        expect.stringMatching(/^previews\.json\.corrupt-/),
      ]),
    );
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining("app IDs 8"),
    );
  });

  it("keeps the canonical store when a corruption repair cannot be written", async () => {
    const root = await createStoreRoot();
    const filePath = join(root, "previews.json");
    const store = new TempPreviewStore(filePath, {
      encode: (token) => ({ value: `encrypted:${token}` }),
      decode: (secret) => secret.value.replace(/^encrypted:/, ""),
    });
    const originalContents = JSON.stringify({
      version: 1,
      records: {
        7: {
          tempId: "temp-valid",
          canonicalUrl: "https://valid.temp.md",
          updateToken: { value: "encrypted:update-secret" },
          expiresAt: null,
          lastPublishedAt: "2026-08-23T00:00:00.000Z",
          state: "active",
        },
        8: { invalid: true },
      },
    });
    await writeFile(filePath, originalContents, "utf8");
    const writeStoreFile = vi
      .spyOn(
        store as unknown as {
          writeStoreFile: (contents: unknown) => Promise<void>;
        },
        "writeStoreFile",
      )
      .mockRejectedValueOnce(new Error("disk full"));

    await expect(store.read(7)).rejects.toThrow("disk full");
    expect(await readFile(filePath, "utf8")).toBe(originalContents);
    const backupName = (await readdir(root)).find((name) =>
      name.startsWith("previews.json.corrupt-"),
    );
    expect(backupName).toBeDefined();
    expect(await readFile(join(root, backupName!), "utf8")).toBe(
      originalContents,
    );

    writeStoreFile.mockRestore();
    await expect(store.read(7)).resolves.toMatchObject({
      tempId: "temp-valid",
      updateToken: "update-secret",
    });
  });

  it("preserves a record whose update capability cannot be decoded", async () => {
    const root = await createStoreRoot();
    const filePath = join(root, "previews.json");
    const store = new TempPreviewStore(filePath, {
      encode: (token) => ({ value: `encrypted:${token}` }),
      decode: () => {
        throw new Error("keychain identity changed");
      },
    });
    const originalContents = JSON.stringify({
      version: 1,
      records: {
        7: {
          tempId: "temp-unreadable",
          canonicalUrl: "https://unreadable.temp.md",
          updateToken: { value: "encrypted:update-secret" },
          expiresAt: null,
          lastPublishedAt: "2026-08-23T00:00:00.000Z",
          state: "active",
        },
      },
    });
    await writeFile(filePath, originalContents, "utf8");

    await expect(store.read(7)).rejects.toBeInstanceOf(
      TempPreviewStoreUnreadableError,
    );
    expect(await readFile(filePath, "utf8")).toBe(originalContents);
    expect(await readdir(root)).toEqual(["previews.json"]);
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining("preserving the encrypted record"),
      expect.any(Error),
    );
  });

  it("recovers an expired record whose capability cannot be decoded", async () => {
    const root = await createStoreRoot();
    const filePath = join(root, "previews.json");
    const store = new TempPreviewStore(filePath, {
      encode: (token) => ({ value: `encrypted:${token}` }),
      decode: () => {
        throw new Error("keychain identity changed");
      },
    });
    const expiresAt = new Date(Date.now() - 60_000).toISOString();
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        records: {
          7: {
            tempId: "temp-expired",
            canonicalUrl: "https://expired.temp.md",
            updateToken: { value: "encrypted:update-secret" },
            expiresAt,
            lastPublishedAt: "2026-08-01T00:00:00.000Z",
            state: "active",
            pendingDeletion: true,
          },
        },
      }),
      "utf8",
    );

    await expect(store.read(7)).resolves.toMatchObject({
      tempId: "temp-expired",
      expiresAt,
      updateToken: undefined,
    });
    await store.remove(7);
    await expect(store.listPendingDeletionAppIds()).resolves.toEqual([]);
  });

  it("recovers a seven-day-old record with a missing expiry", async () => {
    const root = await createStoreRoot();
    const filePath = join(root, "previews.json");
    const store = new TempPreviewStore(filePath, {
      encode: (token) => ({ value: `encrypted:${token}` }),
      decode: () => {
        throw new Error("keychain identity changed");
      },
    });
    const lastPublishedAt = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        records: {
          7: {
            tempId: "temp-expired",
            canonicalUrl: "https://expired.temp.md",
            updateToken: { value: "encrypted:update-secret" },
            expiresAt: null,
            lastPublishedAt,
            state: "active",
          },
        },
      }),
      "utf8",
    );

    await expect(store.read(7)).resolves.toMatchObject({
      tempId: "temp-expired",
      expiresAt: new Date(
        Date.parse(lastPublishedAt) + 7 * 24 * 60 * 60 * 1_000,
      ).toISOString(),
      updateToken: undefined,
    });
  });

  it("removes only the requested app record", async () => {
    const root = await createStoreRoot();
    const filePath = join(root, "previews.json");
    const store = new TempPreviewStore(filePath, {
      encode: (token) => ({ value: `encrypted:${token}` }),
      decode: (secret) => secret.value.replace(/^encrypted:/, ""),
    });
    const record = {
      tempId: "temp",
      canonicalUrl: "https://example.temp.md",
      updateToken: "update-secret",
      expiresAt: null,
      lastPublishedAt: "2026-08-23T00:00:00.000Z",
      state: "active" as const,
    };
    await store.write(7, record);
    await store.write(8, { ...record, tempId: "temp-8" });

    await store.remove(7);

    await expect(store.read(7)).resolves.toBeNull();
    await expect(store.read(8)).resolves.toMatchObject({ tempId: "temp-8" });
  });

  it("persists and clears pending app-deletion markers", async () => {
    const root = await createStoreRoot();
    const filePath = join(root, "previews.json");
    const codec = {
      encode: (token: string) => ({ value: `encrypted:${token}` }),
      decode: (secret: { value: string }) =>
        secret.value.replace(/^encrypted:/, ""),
    };
    const store = new TempPreviewStore(filePath, codec);
    await store.write(7, {
      tempId: "temp-7",
      canonicalUrl: "https://example.temp.md",
      updateToken: "update-secret",
      expiresAt: null,
      lastPublishedAt: "2026-08-23T00:00:00.000Z",
      state: "active",
    });

    await expect(store.markPendingDeletion(7)).resolves.toBe(true);
    await expect(store.markPendingDeletion(8)).resolves.toBe(false);
    await expect(
      new TempPreviewStore(filePath, codec).listPendingDeletionAppIds(),
    ).resolves.toEqual([7]);
    await expect(store.read(7)).resolves.toMatchObject({ tempId: "temp-7" });

    await store.clearPendingDeletion(7);
    await expect(store.listPendingDeletionAppIds()).resolves.toEqual([]);
  });
});
