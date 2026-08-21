import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readSettings, uploadToBlob } = vi.hoisted(() => ({
  readSettings: vi.fn(),
  uploadToBlob: vi.fn(),
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => readSettings(),
}));
vi.mock("../vercel_blob", () => ({ uploadToBlob }));

import {
  buildDataSourceAttachmentContext,
  persistDataSourceAttachments,
} from "./data_source_attachments";

let vaultRoot: string;

beforeEach(async () => {
  vaultRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "data-source-attachment-"),
  );
  readSettings.mockReturnValue({
    storage: { destination: "local", localVaultPath: vaultRoot },
  });
});

afterEach(async () => {
  await fs.promises.rm(vaultRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("persistDataSourceAttachments", () => {
  it("writes image bytes into the selected local vault and returns real metadata", async () => {
    const bytes = Buffer.from("jpeg-test-bytes");
    const [stored] = await persistDataSourceAttachments([
      {
        name: "Bruce Wayne.jpg",
        mimeType: "image/jpeg",
        dataBase64: bytes.toString("base64"),
      },
    ]);

    expect(stored.storageKey).toMatch(
      /^Media\/Images\/Records\/Bruce-Wayne-[\w-]+\.jpg$/,
    );
    expect(stored.storageUrl).toContain("dyad-media://vault/");
    expect(stored.mimeType).toBe("image/jpeg");
    expect(stored.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await fs.promises.readFile(path.join(vaultRoot, stored.storageKey)),
    ).toEqual(bytes);
  });

  it("uploads to the selected cloud vault and uses the provider result", async () => {
    readSettings.mockReturnValue({ storage: { destination: "cloud" } });
    uploadToBlob.mockResolvedValue({
      url: "https://blob.example/record.jpg",
      pathname: "vault/Media/Images/Records/record.jpg",
    });

    const [stored] = await persistDataSourceAttachments([
      {
        name: "record.jpg",
        mimeType: "image/jpeg",
        dataBase64: Buffer.from("cloud-image").toString("base64"),
      },
    ]);

    expect(stored.storageUrl).toBe("https://blob.example/record.jpg");
    expect(stored.storageKey).toBe("vault/Media/Images/Records/record.jpg");
    expect(uploadToBlob).toHaveBeenCalledOnce();
  });

  it("refuses placeholder metadata when no vault is connected", async () => {
    readSettings.mockReturnValue({ storage: { destination: "local" } });
    await expect(
      persistDataSourceAttachments([
        {
          name: "record.jpg",
          mimeType: "image/jpeg",
          dataBase64: Buffer.from("image").toString("base64"),
        },
      ]),
    ).rejects.toThrow("No local file vault is connected");
  });
});

describe("buildDataSourceAttachmentContext", () => {
  it("labels persisted fields as trusted and forbids placeholder paths", () => {
    const context = buildDataSourceAttachmentContext([
      {
        originalName: "record.jpg",
        storageUrl: "dyad-media://vault/real",
        storageKey: "Media/Images/Records/real.jpg",
        mimeType: "image/jpeg",
        sha256: "abc123",
        sizeBytes: 42,
      },
    ]);

    expect(context).toContain("Trusted attachment storage metadata");
    expect(context).toContain("storage_key: Media/Images/Records/real.jpg");
    expect(context).toContain("Never invent");
    expect(context).toContain("never create a placeholder path");
  });
});
