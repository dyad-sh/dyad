import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  injectChunkId,
  posthogHiddenSourcemapsPlugin,
  stagePostHogSourcemaps,
} from "@/lib/posthog_sourcemaps";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function sourceMap(mappings: string): string {
  return JSON.stringify({
    version: 3,
    file: "bundle.js",
    sources: ["../src/a.ts", "../src/b.ts"],
    names: ["foo"],
    mappings,
  });
}

describe("posthogHiddenSourcemapsPlugin", () => {
  it("leaves the build untouched unless uploads are enabled", () => {
    expect(posthogHiddenSourcemapsPlugin({})).toEqual([]);
    expect(
      posthogHiddenSourcemapsPlugin({ POSTHOG_UPLOAD_SOURCEMAPS: "1" }),
    ).toEqual([]);
  });

  it("emits hidden source maps when uploads are enabled", () => {
    const [plugin] = posthogHiddenSourcemapsPlugin({
      POSTHOG_UPLOAD_SOURCEMAPS: "true",
    });
    const config = plugin.config as () => unknown;
    expect(config()).toEqual({ build: { sourcemap: "hidden" } });
  });
});

describe("injectChunkId", () => {
  const MAPPINGS = "AAAA,SAASA;ACAA,GAAG;;ADEA";
  // Minified like Vite's main-process output: the directive and code share a line.
  const MINIFIED_CJS =
    '"use strict";module.exports=(function(){return this===undefined})();';

  it("registers the chunk ID when the bundle runs, keeping strict mode", () => {
    const { chunkId, code } = injectChunkId(MINIFIED_CJS, sourceMap(MAPPINGS));

    expect(code.startsWith(MINIFIED_CJS)).toBe(true);
    const context: Record<string, unknown> = { module: { exports: null } };
    vm.runInNewContext(code, context);
    // `this` is undefined in a plain call only in strict mode.
    expect((context.module as { exports: unknown }).exports).toBe(true);
    expect(Object.values(context._posthogChunkIds as object)).toEqual([
      chunkId,
    ]);
  });

  it("leaves the code before it and the map's mappings unchanged", () => {
    const original = sourceMap(MAPPINGS);
    const { chunkId, map } = injectChunkId(MINIFIED_CJS, original);
    expect(JSON.parse(map)).toEqual({
      ...JSON.parse(original),
      chunk_id: chunkId,
    });
  });

  it("drops a trailing sourceMappingURL comment, since the map is not shipped", () => {
    const { code } = injectChunkId(
      "foo();\n//# sourceMappingURL=worker.js.map\n",
      sourceMap(MAPPINGS),
    );
    expect(code).not.toContain("sourceMappingURL");
    expect(code.startsWith("foo();\n;!function")).toBe(true);
  });

  it("produces bundles Node can parse as scripts and as modules", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "posthog-inject-"));
    try {
      const bundles = {
        "main.cjs": MINIFIED_CJS,
        // No trailing newline or semicolon before the appended snippet.
        "worker.cjs": '"use strict";const a=require("fs")\nmodule.exports=a',
        "index.mjs": 'import fs from"node:fs";export const x=fs',
        "comment.mjs": "export const y=1// trailing comment",
      };
      for (const [file, source] of Object.entries(bundles)) {
        const target = path.join(dir, file);
        await writeFile(
          target,
          injectChunkId(source, sourceMap(MAPPINGS)).code,
        );
        execFileSync(process.execPath, ["--check", target]);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes the same UUID-format chunk ID into the bundle and the map", () => {
    const { chunkId, code, map } = injectChunkId("foo();", sourceMap(MAPPINGS));
    expect(chunkId).toMatch(UUID);
    expect(code.endsWith(`\n//# chunkId=${chunkId}\n`)).toBe(true);
    expect(code).toContain(`e._posthogChunkIds[n]="${chunkId}"`);
    expect(JSON.parse(map)).toMatchObject({ chunk_id: chunkId, version: 3 });
  });

  it("derives the chunk ID from both files, so rebuilds reproduce it", () => {
    const id = (code: string, mappings: string) =>
      injectChunkId(code, sourceMap(mappings)).chunkId;
    expect(id("foo();", "AAAA")).toBe(id("foo();", "AAAA"));
    expect(id("foo();", "AAAA")).not.toBe(id("bar();", "AAAA"));
    expect(id("foo();", "AAAA")).not.toBe(id("foo();", "AACA"));
  });

  it("refuses a bundle that already has a chunk ID", () => {
    const once = injectChunkId("foo();", sourceMap("AAAA"));
    expect(() => injectChunkId(once.code, sourceMap("AAAA"))).toThrow(
      "already has a chunk ID",
    );
    expect(() => injectChunkId("foo();", once.map)).toThrow(
      "already has a chunk ID",
    );
  });
});

describe("stagePostHogSourcemaps", () => {
  let root: string;
  let buildPath: string;
  let stagingRoot: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "posthog-stage-"));
    buildPath = path.join(root, "app");
    stagingRoot = path.join(root, "sourcemaps");
    env = {
      POSTHOG_UPLOAD_SOURCEMAPS: "true",
      POSTHOG_SOURCEMAPS_DIR: stagingRoot,
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function seed(files: Record<string, string>) {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(buildPath, ".vite", file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }

  const stage = () =>
    stagePostHogSourcemaps({ buildPath, target: "linux-x64", env });

  it("does nothing without the opt-in flag", async () => {
    await seed({
      "build/main.js": "foo();",
      "build/main.js.map": sourceMap("AAAA"),
    });
    await stagePostHogSourcemaps({ buildPath, target: "linux-x64", env: {} });
    expect(
      await readFile(path.join(buildPath, ".vite/build/main.js"), "utf8"),
    ).toBe("foo();");
  });

  it("fails when opted in without a staging directory", async () => {
    delete env.POSTHOG_SOURCEMAPS_DIR;
    await expect(stage()).rejects.toThrow("POSTHOG_SOURCEMAPS_DIR");
  });

  it("tags shipped bundles and moves their maps out of the app", async () => {
    await seed({
      "build/main.js": '"use strict";foo();',
      "build/main.js.map": sourceMap("AAAA;AACA"),
      "renderer/main_window/assets/index-abc.js": "bar();",
      "renderer/main_window/assets/index-abc.js.map": sourceMap("AAAA"),
      "build/worker.js": "baz();",
    });
    await stage();

    const staged = path.join(stagingRoot, "linux-x64");
    expect((await readdir(staged, { recursive: true })).sort()).toEqual(
      [
        "build",
        "build/main.js",
        "build/main.js.map",
        "renderer",
        "renderer/main_window",
        "renderer/main_window/assets",
        "renderer/main_window/assets/index-abc.js",
        "renderer/main_window/assets/index-abc.js.map",
      ].map((p) => path.normalize(p)),
    );
    for (const bundle of [
      "build/main.js",
      "renderer/main_window/assets/index-abc.js",
    ]) {
      const shipped = await readFile(
        path.join(buildPath, ".vite", bundle),
        "utf8",
      );
      const map = JSON.parse(
        await readFile(path.join(staged, `${bundle}.map`), "utf8"),
      );
      expect(shipped).toContain(`//# chunkId=${map.chunk_id}`);
      expect(await readFile(path.join(staged, bundle), "utf8")).toBe(shipped);
    }
    // No maps ship, and a bundle without a map is left alone.
    const shippedFiles = await readdir(path.join(buildPath, ".vite"), {
      recursive: true,
    });
    expect(shippedFiles.filter((f) => f.endsWith(".map"))).toEqual([]);
    expect(
      await readFile(path.join(buildPath, ".vite/build/worker.js"), "utf8"),
    ).toBe("baz();");
  });

  it("replaces maps staged by a failed earlier attempt", async () => {
    const stale = path.join(stagingRoot, "linux-x64", "build", "old.js.map");
    await mkdir(path.dirname(stale), { recursive: true });
    await writeFile(stale, "{}");
    await seed({
      "build/main.js": "foo();",
      "build/main.js.map": sourceMap("AAAA"),
    });
    await stage();
    await expect(readFile(stale)).rejects.toThrow();
  });

  it("fails when a map has no bundle, since it would ship", async () => {
    await seed({
      "build/main.js": "foo();",
      "build/main.js.map": sourceMap("AAAA"),
      "renderer/orphan.js.map": sourceMap("AAAA"),
    });
    await expect(stage()).rejects.toThrow(
      path.normalize("renderer/orphan.js.map"),
    );
  });

  it("fails when the build produced no maps", async () => {
    await seed({ "build/main.js": "foo();" });
    await expect(stage()).rejects.toThrow("No source maps found");
  });
});
