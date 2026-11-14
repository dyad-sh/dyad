import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

for (const modern of [false, true]) {
  test(`hydrates ${modern ? "lazy" : "postinstall"} Electron without importing its entry`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "hydrate-electron-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const pkg = join(root, "node_modules/electron");
    mkdirSync(pkg, { recursive: true });
    copyFileSync(
      new URL("./hydrate-electron.mjs", import.meta.url),
      join(root, "hydrate-electron.mjs"),
    );
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({
        name: "electron",
        main: "index.cjs",
        ...(modern ? { bin: { "install-electron": "download.cjs" } } : {}),
      }),
    );
    writeFileSync(
      join(pkg, "index.cjs"),
      'throw new Error("binary not installed");',
    );
    const marker = join(root, "installed.json");
    writeFileSync(
      join(pkg, modern ? "download.cjs" : "install.js"),
      'require("node:fs").writeFileSync(process.env.HYDRATE_TEST_MARKER, JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.HYDRATE_TEST_EXIT || 0));',
    );
    const run = (code = "0") =>
      spawnSync(process.execPath, [join(root, "hydrate-electron.mjs")], {
        env: {
          ...process.env,
          HYDRATE_TEST_MARKER: marker,
          HYDRATE_TEST_EXIT: code,
        },
      });
    assert.equal(run().status, 0);
    assert.deepEqual(JSON.parse(readFileSync(marker, "utf8")), ["--no"]);
    assert.equal(run("7").status, 7);
  });
}
