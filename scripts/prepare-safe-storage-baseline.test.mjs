import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareSafeStorageBaseline } from "./prepare-safe-storage-baseline.mjs";

test("baseline preparation enables real writes and rejects drift", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "safe-storage-baseline-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src/main"), { recursive: true });
  const pkgPath = path.join(root, "package.json");
  const settingsPath = path.join(root, "src/main/settings.ts");
  fs.writeFileSync(
    pkgPath,
    JSON.stringify({ devDependencies: { electron: "40.0.0" } }),
  );
  const original =
    "if (safeStorage.isEncryptionAvailable() && !IS_TEST_BUILD) { encrypt(); }";
  fs.writeFileSync(settingsPath, original);
  prepareSafeStorageBaseline(root);
  assert.equal(
    fs.readFileSync(settingsPath, "utf8"),
    "if (safeStorage.isEncryptionAvailable()) { encrypt(); }",
  );
  assert.throws(() => prepareSafeStorageBaseline(root), /exactly one/);
  fs.writeFileSync(settingsPath, original + original);
  assert.throws(() => prepareSafeStorageBaseline(root), /exactly one/);
  fs.writeFileSync(
    pkgPath,
    JSON.stringify({ devDependencies: { electron: "43.0.0" } }),
  );
  assert.throws(() => prepareSafeStorageBaseline(root), /pinned Electron 40/);
});
