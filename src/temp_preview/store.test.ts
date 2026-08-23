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
});
