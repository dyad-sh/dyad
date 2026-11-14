import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Resolve package metadata without importing electron: newer versions lazily
// install the binary, so importing its main entry before hydration can fail.
const require = createRequire(import.meta.url);
const packagePath = require.resolve("electron/package.json");
const metadata = require(packagePath);
const installer = metadata.bin?.["install-electron"] ?? "install.js";
const result = spawnSync(
  process.execPath,
  [resolve(dirname(packagePath), installer), "--no"],
  {
    stdio: "inherit",
    env: process.env,
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
