import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  removeUnusedAppPackageFiles,
  removeUnusedCopiedResources,
} from "@/lib/packaging_cleanup";

const tempDirectories: string[] = [];

async function writeFixtureFile(filePath: string, contents = "fixture") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

async function expectMissing(filePath: string) {
  await expect(fs.stat(filePath)).rejects.toThrow();
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("removeUnusedAppPackageFiles", () => {
  it("keeps target node-pty binaries and removes incompatible/debug artifacts", async () => {
    const buildPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-package-cleanup-app-"),
    );
    tempDirectories.push(buildPath);

    const nodePtyPath = path.join(buildPath, "node_modules/node-pty");
    const supportedBinary = path.join(
      nodePtyPath,
      "prebuilds/darwin-arm64/pty.node",
    );
    const unsupportedBinary = path.join(
      nodePtyPath,
      "prebuilds/win32-x64/pty.node",
    );
    const debugSymbols = path.join(nodePtyPath, "prebuilds/win32-x64/pty.pdb");
    const rebuiltBinary = path.join(nodePtyPath, "build/Release/pty.node");
    const spawnHelper = path.join(nodePtyPath, "build/Release/spawn-helper");
    const buildIntermediate = path.join(
      nodePtyPath,
      "build/Release/obj.target/pty/src/unix/pty.o",
    );

    await Promise.all([
      writeFixtureFile(supportedBinary),
      writeFixtureFile(unsupportedBinary),
      writeFixtureFile(debugSymbols),
      writeFixtureFile(rebuiltBinary),
      writeFixtureFile(spawnHelper),
      writeFixtureFile(buildIntermediate),
      writeFixtureFile(path.join(nodePtyPath, "src/index.ts")),
      writeFixtureFile(path.join(nodePtyPath, "lib/index.js.map")),
    ]);

    await removeUnusedAppPackageFiles(buildPath, "darwin", "arm64");

    await expect(fs.readFile(supportedBinary, "utf8")).resolves.toBe("fixture");
    await expect(fs.readFile(rebuiltBinary, "utf8")).resolves.toBe("fixture");
    await expect(fs.readFile(spawnHelper, "utf8")).resolves.toBe("fixture");
    await expectMissing(unsupportedBinary);
    await expectMissing(debugSymbols);
    await expectMissing(buildIntermediate);
    await expectMissing(path.join(nodePtyPath, "src/index.ts"));
    await expectMissing(path.join(nodePtyPath, "lib/index.js.map"));
  });

  it("keeps better-sqlite3 runtime files and removes build intermediates", async () => {
    const buildPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-package-cleanup-sqlite-"),
    );
    tempDirectories.push(buildPath);

    const betterSqlitePath = path.join(
      buildPath,
      "node_modules/better-sqlite3",
    );
    const runtimeJs = path.join(betterSqlitePath, "lib/database.js");
    const runtimeBinary = path.join(
      betterSqlitePath,
      "build/Release/better_sqlite3.node",
    );
    const sqliteSource = path.join(betterSqlitePath, "deps/sqlite3/sqlite3.c");
    const staticLibrary = path.join(
      betterSqlitePath,
      "build/Release/sqlite3.a",
    );
    const buildObject = path.join(
      betterSqlitePath,
      "build/Release/obj.target/sqlite3/sqlite3.o",
    );

    await Promise.all([
      writeFixtureFile(runtimeJs),
      writeFixtureFile(runtimeBinary),
      writeFixtureFile(sqliteSource),
      writeFixtureFile(staticLibrary),
      writeFixtureFile(buildObject),
      writeFixtureFile(path.join(betterSqlitePath, "src/addon.cpp")),
    ]);

    await removeUnusedAppPackageFiles(buildPath, "darwin", "arm64");

    await expect(fs.readFile(runtimeJs, "utf8")).resolves.toBe("fixture");
    await expect(fs.readFile(runtimeBinary, "utf8")).resolves.toBe("fixture");
    await expectMissing(sqliteSource);
    await expectMissing(staticLibrary);
    await expectMissing(buildObject);
    await expectMissing(path.join(betterSqlitePath, "src/addon.cpp"));
  });
});

describe("removeUnusedCopiedResources", () => {
  it("keeps active Dyad Electron locales and removes git-lfs", async () => {
    const buildPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-package-cleanup-resources-"),
    );
    tempDirectories.push(buildPath);

    const appResourcesPath = path.join(
      buildPath,
      "dyad.app/Contents/Resources",
    );
    const electronResourcesPath = path.join(
      buildPath,
      "dyad.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources",
    );
    const keptLocale = path.join(
      electronResourcesPath,
      "pt_BR.lproj/locale.pak",
    );
    const removedLocale = path.join(
      electronResourcesPath,
      "fr.lproj/locale.pak",
    );
    const gitLfs = path.join(appResourcesPath, "git/libexec/git-core/git-lfs");

    await Promise.all([
      writeFixtureFile(keptLocale),
      writeFixtureFile(removedLocale),
      writeFixtureFile(gitLfs),
    ]);

    await removeUnusedCopiedResources(buildPath, "darwin");

    await expect(fs.readFile(keptLocale, "utf8")).resolves.toBe("fixture");
    await expectMissing(removedLocale);
    await expectMissing(gitLfs);
  });

  it("removes unsupported top-level Electron locale paks on non-mac targets", async () => {
    const buildPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-package-cleanup-locale-paks-"),
    );
    tempDirectories.push(buildPath);

    const keptPak = path.join(buildPath, "locales/zh-CN.pak");
    const removedPak = path.join(buildPath, "locales/fr.pak");

    await Promise.all([
      writeFixtureFile(keptPak),
      writeFixtureFile(removedPak),
    ]);

    await removeUnusedCopiedResources(buildPath, "linux");

    await expect(fs.readFile(keptPak, "utf8")).resolves.toBe("fixture");
    await expectMissing(removedPak);
  });
});
