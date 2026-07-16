import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  copyProductionDataToDev,
  getProcessesUsingDataDirectories,
  getProductionUserDataPath,
} from "./copy-data-to-dev.mjs";

test("resolves Electron's production user data path on each platform", () => {
  assert.equal(
    getProductionUserDataPath({ platform: "darwin", homeDir: "/home/me" }),
    path.join("/home/me", "Library", "Application Support", "dyad"),
  );
  assert.equal(
    getProductionUserDataPath({
      platform: "win32",
      env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
    }),
    path.join("C:\\Users\\me\\AppData\\Roaming", "dyad"),
  );
  assert.equal(
    getProductionUserDataPath({
      platform: "linux",
      env: { XDG_CONFIG_HOME: "/config" },
      homeDir: "/home/me",
    }),
    path.join("/config", "dyad"),
  );
});

test("reports unique processes using production data", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "dyad-copy-processes-"));
  writeFileSync(path.join(root, "sqlite.db"), "database");

  assert.deepEqual(
    getProcessesUsingDataDirectories([root], {
      platform: "darwin",
      runSync: () => "123\n456\n123\n",
    }),
    ["123", "456"],
  );
});

test("reports the production Dyad process on Windows", () => {
  assert.deepEqual(
    getProcessesUsingDataDirectories([], {
      platform: "win32",
      runSync: () =>
        '"dyad.exe","789","Console","1","123,456 K"\r\nINFO: No other tasks',
    }),
    ["789"],
  );
});

test("replaces development data only after copying durable production data", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "dyad-copy-data-"));
  const source = path.join(root, "production");
  const destination = path.join(root, "userData");
  mkdirSync(path.join(source, "dyad-apps", "my-app"), { recursive: true });
  mkdirSync(path.join(source, "Cache"), { recursive: true });
  mkdirSync(destination);
  writeFileSync(path.join(source, "sqlite.db"), "production database");
  writeFileSync(path.join(source, "user-settings.json"), "settings");
  writeFileSync(path.join(source, "dyad-apps", "my-app", "index.ts"), "app");
  writeFileSync(path.join(source, "Cache", "cache.bin"), "cache");
  writeFileSync(path.join(destination, "stale.txt"), "stale");

  copyProductionDataToDev({
    source,
    destination,
    platform: "win32",
    runSync: () => "INFO: No tasks are running",
    now: () => 123,
  });

  assert.equal(
    readFileSync(path.join(destination, "sqlite.db"), "utf8"),
    "production database",
  );
  assert.equal(
    readFileSync(
      path.join(destination, "dyad-apps", "my-app", "index.ts"),
      "utf8",
    ),
    "app",
  );
  assert.throws(() => readFileSync(path.join(destination, "stale.txt")));
  assert.throws(() =>
    readFileSync(path.join(destination, "Cache", "cache.bin")),
  );
});
