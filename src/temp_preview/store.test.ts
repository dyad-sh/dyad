import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TempPreviewStore } from "./store";

describe("TempPreviewStore", () => {
  it("persists an encoded update capability and returns its decoded value", async () => {
    const root = await mkdtemp(join(tmpdir(), "dyad-temp-preview-store-"));
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
});
