// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { build } from "vite";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sandboxedPreloadPlugin } from "./sandboxed_preload";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function bundle(code: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "preload-audit-"));
  roots.push(root);
  const entry = path.join(root, "preload.js");
  await writeFile(entry, code);
  return build({
    configFile: false,
    logLevel: "silent",
    plugins: [sandboxedPreloadPlugin()],
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ["cjs"] },
      rollupOptions: { external: ["electron", "node:fs", "events"] },
    },
  });
}
it("allows Electron imports and browser APIs in a bundled preload", async () => {
  await expect(
    bundle(
      'import { contextBridge } from "electron"; contextBridge.exposeInMainWorld("decode", x => new TextDecoder().decode(x));',
    ),
  ).resolves.toBeDefined();
});
it("rejects a Node dependency left external by the bundler", async () => {
  await expect(
    bundle(
      'import { readFileSync } from "node:fs"; console.log(readFileSync("x"));',
    ),
  ).rejects.toThrow(/Sandboxed preload/);
});
it("rejects CommonJS shim dependencies and dynamic requires", async () => {
  await expect(bundle('console.log(require("events"));')).rejects.toThrow(
    /cannot require events/,
  );
  await expect(
    bundle("console.log(require(globalThis.moduleName));"),
  ).rejects.toThrow(/cannot require/);
});
