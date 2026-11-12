import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The baseline checkout is immutable; this is its only test-only source patch.
// Fail closed if a future baseline no longer has the expected encryption guard.
export function prepareSafeStorageBaseline(root) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  if (pkg.devDependencies.electron !== "40.0.0") {
    throw new Error("The safeStorage baseline must use pinned Electron 40.0.0");
  }
  const settingsPath = path.join(root, "src/main/settings.ts");
  const source = fs.readFileSync(settingsPath, "utf8");
  const guard = "safeStorage.isEncryptionAvailable() && !IS_TEST_BUILD";
  if (source.split(guard).length !== 2) {
    throw new Error("Expected exactly one baseline settings encryption guard");
  }
  fs.writeFileSync(
    settingsPath,
    source.replace(guard, "safeStorage.isEncryptionAvailable()"),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (!process.argv[2]) throw new Error("Pass the baseline checkout directory");
  prepareSafeStorageBaseline(path.resolve(process.argv[2]));
}
