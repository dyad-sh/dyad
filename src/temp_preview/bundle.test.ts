import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverTempPreviewBundle, TEMP_PREVIEW_MAX_FILES } from "./bundle";

async function createBundleRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dyad-temp-preview-bundle-"));
}

describe("discoverTempPreviewBundle", () => {
  it("describes a static build with stable paths, hashes and content types", async () => {
    const root = await createBundleRoot();
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<main>Hello</main>");
    await writeFile(join(root, "assets", "app.js"), "console.log('hello')");

    const files = await discoverTempPreviewBundle(root);

    expect(files.map((file) => file.path)).toEqual([
      "assets/app.js",
      "index.html",
    ]);
    expect(files[0]).toMatchObject({ contentType: "text/javascript" });
    expect(files[0].hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires a root index.html and ignores symbolic links", async () => {
    const root = await createBundleRoot();
    const outside = join(root, "outside.html");
    await writeFile(outside, "secret");
    await symlink(outside, join(root, "linked.html"));

    await expect(discoverTempPreviewBundle(root)).rejects.toThrow(
      "dist/index.html",
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
