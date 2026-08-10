import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readSettings = vi.fn();
vi.mock("@/main/settings", () => ({
  readSettings: () => readSettings(),
}));

import {
  buildVaultMediaUrl,
  listVaultMedia,
  resolveVaultMediaPath,
} from "./vault_media";

let vaultRoot: string;

function setVault(localVaultPath: string | undefined) {
  readSettings.mockReturnValue({ storage: { localVaultPath } });
}

beforeEach(async () => {
  vaultRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "vault-media-test-"),
  );
  setVault(vaultRoot);
});

afterEach(async () => {
  await fs.promises.rm(vaultRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

async function writeFile(relativePath: string, contents = "x") {
  const full = path.join(vaultRoot, relativePath);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, contents);
  return full;
}

describe("listVaultMedia", () => {
  it("returns images and videos from anywhere under Media, including user-added files", async () => {
    await writeFile("Media/Images/Generated/cat.png");
    await writeFile("Media/Images/my-own-photo.jpg");
    await writeFile("Media/Videos/Generated/clip.mp4");
    await writeFile("Media/Images/nested/deeper/shot.webp");

    const files = await listVaultMedia();
    const byName = Object.fromEntries(files.map((f) => [f.fileName, f]));

    expect(Object.keys(byName).sort()).toEqual([
      "cat.png",
      "clip.mp4",
      "my-own-photo.jpg",
      "shot.webp",
    ]);
    expect(byName["cat.png"].kind).toBe("image");
    expect(byName["cat.png"].relativePath).toBe(
      "Media/Images/Generated/cat.png",
    );
    expect(byName["clip.mp4"].kind).toBe("video");
    expect(byName["clip.mp4"].mimeType).toBe("video/mp4");
  });

  it("skips non-media files and internal folders", async () => {
    await writeFile("Media/Images/notes.md");
    await writeFile("Media/Images/.obsidian/workspace.png");
    await writeFile("Media/Files/archive.zip");
    await writeFile("Notes/Generated Media/cat.md");

    expect(await listVaultMedia()).toEqual([]);
  });

  it("skips macOS metadata sidecars that vaults on external volumes collect", async () => {
    await writeFile("Media/Images/Generated/cat.png");
    // AppleDouble companions carry a media extension but hold no image data.
    await writeFile("Media/Images/Generated/._cat.png");
    await writeFile("Media/Images/.DS_Store");

    const files = await listVaultMedia();
    expect(files.map((f) => f.fileName)).toEqual(["cat.png"]);
  });

  it("returns nothing when no vault is configured", async () => {
    setVault(undefined);
    expect(await listVaultMedia()).toEqual([]);
  });
});

describe("resolveVaultMediaPath", () => {
  it("resolves paths inside the Media folder", async () => {
    const written = await writeFile("Media/Images/Generated/cat.png");
    expect(resolveVaultMediaPath("Media/Images/Generated/cat.png")).toBe(
      path.resolve(written),
    );
  });

  it("rejects traversal out of the Media folder", () => {
    expect(resolveVaultMediaPath("Media/../Notes/secret.md")).toBeNull();
    expect(resolveVaultMediaPath("../../etc/passwd")).toBeNull();
    expect(resolveVaultMediaPath("Notes/System Notes.md")).toBeNull();
    // The Media folder itself is not a servable file.
    expect(resolveVaultMediaPath("Media")).toBeNull();
  });

  it("rejects everything when no vault is configured", () => {
    setVault(undefined);
    expect(resolveVaultMediaPath("Media/Images/cat.png")).toBeNull();
  });
});

describe("buildVaultMediaUrl", () => {
  it("encodes the relative path so slashes survive URL parsing", () => {
    const url = buildVaultMediaUrl("Media/Images/Generated/my cat.png");
    expect(url).toBe(
      "dyad-media://vault/Media%2FImages%2FGenerated%2Fmy%20cat.png",
    );
    expect(decodeURIComponent(new URL(url).pathname.slice(1))).toBe(
      "Media/Images/Generated/my cat.png",
    );
  });
});
