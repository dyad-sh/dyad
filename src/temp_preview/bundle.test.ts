import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverTempPreviewBundle, TEMP_PREVIEW_MAX_FILES } from "./bundle";

const bundleRoots: string[] = [];

async function createBundleRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dyad-temp-preview-bundle-"));
  bundleRoots.push(root);
  return root;
}

describe("discoverTempPreviewBundle", () => {
  afterEach(async () => {
    await Promise.all(
      bundleRoots.splice(0).map((root) =>
        rm(root, {
          recursive: true,
          force: true,
        }),
      ),
    );
  });

  it("describes a static build with stable paths, hashes and content types", async () => {
    const root = await createBundleRoot();
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<main>Hello</main>");
    await writeFile(join(root, "assets", "app.js"), "console.log('hello')");
    await writeFile(join(root, "assets", "module.wasm"), "wasm");

    const files = await discoverTempPreviewBundle(root);

    expect(files.map((file) => file.path)).toEqual([
      "assets/app.js",
      "assets/module.wasm",
      "index.html",
    ]);
    expect(files[0]).toMatchObject({ contentType: "text/javascript" });
    expect(files[0].hash).toMatch(/^[a-f0-9]{64}$/);
    expect(files[1]).toMatchObject({ contentType: "application/wasm" });
    expect(new TextDecoder().decode(files[0].contents)).toBe(
      "console.log('hello')",
    );

    await writeFile(join(root, "assets", "app.js"), "changed after snapshot");
    expect(new TextDecoder().decode(files[0].contents)).toBe(
      "console.log('hello')",
    );
  });

  it("requires a root index.html", async () => {
    const root = await createBundleRoot();

    await expect(discoverTempPreviewBundle(root)).rejects.toThrow(
      "dist/index.html",
    );
  });

  it("ignores symbolic links inside the build output", async () => {
    const root = await createBundleRoot();
    const outside = await createBundleRoot();
    await writeFile(join(root, "index.html"), "ok");
    await writeFile(join(outside, "secret.html"), "secret");
    await symlink(
      outside,
      join(root, "linked-assets"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const files = await discoverTempPreviewBundle(root);

    expect(files.map((file) => file.path)).toEqual(["index.html"]);
  });

  it("rejects a symbolic link used as the build-output root", async () => {
    const parent = await createBundleRoot();
    const target = await createBundleRoot();
    await writeFile(join(target, "index.html"), "ok");
    const linkedRoot = join(parent, "dist");
    await symlink(
      target,
      linkedRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(discoverTempPreviewBundle(linkedRoot)).rejects.toThrow(
      "must not be a symbolic link",
    );
  });

  it("reports a missing build-output directory clearly", async () => {
    const root = await createBundleRoot();

    await expect(
      discoverTempPreviewBundle(join(root, "missing-dist")),
    ).rejects.toThrow("did not produce a dist directory");
  });

  it("rejects an oversized bundle before hashing file contents", async () => {
    const root = await createBundleRoot();
    await writeFile(join(root, "index.html"), "ok");
    await Promise.all(
      Array.from({ length: 6 }, (_, index) => {
        const filePath = join(root, `asset-${index}.bin`);
        return writeFile(filePath, "").then(() =>
          truncate(filePath, 9 * 1024 * 1024),
        );
      }),
    );

    await expect(discoverTempPreviewBundle(root)).rejects.toThrow(
      "50 MB temporary preview limit",
    );
  });

  it("rejects bundles over the public file-count limit", async () => {
    const root = await createBundleRoot();
    await writeFile(join(root, "index.html"), "ok");
    await Promise.all(
      Array.from({ length: TEMP_PREVIEW_MAX_FILES }, (_, index) =>
        writeFile(join(root, `asset-${index}.txt`), "x"),
      ),
    );

    await expect(discoverTempPreviewBundle(root)).rejects.toThrow(
      `more than ${TEMP_PREVIEW_MAX_FILES} files`,
    );
  });
});
