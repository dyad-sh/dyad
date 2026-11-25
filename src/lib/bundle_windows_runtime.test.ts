import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleMustardscriptWindowsRuntime } from "./bundle_windows_runtime";

describe("bundleMustardscriptWindowsRuntime", () => {
  let root: string;
  let appPath: string;
  let sourceDir: string;
  let addonDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "vcrt-"));
    appPath = path.join(root, "app");
    sourceDir = path.join(root, "System32");
    addonDir = path.join(
      appPath,
      "node_modules",
      "@mustardscript",
      "binding-win32-x64-msvc",
    );
    await fs.mkdir(addonDir, { recursive: true });
    await fs.mkdir(sourceDir);
    await fs.writeFile(path.join(sourceDir, "vcruntime140.dll"), "runtime");
  });

  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it("copies vcruntime140.dll next to the win32-x64 addon", async () => {
    await bundleMustardscriptWindowsRuntime(appPath, "win32", "x64", sourceDir);
    await expect(
      fs.readFile(path.join(addonDir, "vcruntime140.dll"), "utf8"),
    ).resolves.toBe("runtime");
  });

  it("does nothing on other targets", async () => {
    await bundleMustardscriptWindowsRuntime(
      appPath,
      "darwin",
      "x64",
      sourceDir,
    );
    await bundleMustardscriptWindowsRuntime(
      appPath,
      "win32",
      "arm64",
      sourceDir,
    );
    await expect(fs.readdir(addonDir)).resolves.toEqual([]);
  });

  it("fails the build when the runtime is missing", async () => {
    await fs.rm(path.join(sourceDir, "vcruntime140.dll"));
    await expect(
      bundleMustardscriptWindowsRuntime(appPath, "win32", "x64", sourceDir),
    ).rejects.toThrow(/vcruntime140\.dll/);
  });
});
