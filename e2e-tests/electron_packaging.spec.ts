import { test, expect, _electron } from "@playwright/test";
import { findLatestBuild, parseElectronApp } from "electron-playwright-helpers";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

test("packaged native dependencies work in the target Electron runtime", async () => {
  test.skip(
    process.env.DYAD_E2E_ELECTRON_QUALIFICATION !== "1",
    "Requires the hydrated Electron runtime from the qualification job",
  );
  const build = parseElectronApp(findLatestBuild());
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  if (process.platform === "win32") {
    await access(
      path.join(
        path.dirname(build.executable),
        `${path.basename(build.executable, ".exe")}_wer.dll`,
      ),
    );
  }
  const application = await _electron.launch({
    args: [
      path.resolve("e2e-tests/helpers/packaged-native-probe.cjs"),
      build.resourcesDir,
    ],
  });
  try {
    const result = await application.evaluate(
      () => (globalThis as any).packagedNativeProbe,
    );
    expect(result).toEqual({
      electron: manifest.devDependencies.electron,
      arch: build.arch,
    });
  } finally {
    await application.close();
  }
});
