import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    const windowsBuildDepsArtifact = path.join(
      nodePtyPath,
      "build/deps/winpty/src/Release/obj/winpty-agent/Agent.obj",
    );
    const windowsDebugArtifacts = [
      "build/Release/winpty-agent.iobj",
      "build/Release/winpty-agent.ipdb",
      "build/Release/winpty-agent.tlog",
      "build/Release/pty.vcxproj",
      "build/Release/pty.vcxproj.filters",
      "build/Release/winpty.lib",
      "build/Release/winpty.exp",
    ].map((file) => path.join(nodePtyPath, file));

    await Promise.all([
      writeFixtureFile(supportedBinary),
      writeFixtureFile(unsupportedBinary),
      writeFixtureFile(debugSymbols),
      writeFixtureFile(rebuiltBinary),
      writeFixtureFile(spawnHelper),
      writeFixtureFile(buildIntermediate),
      writeFixtureFile(windowsBuildDepsArtifact),
      ...windowsDebugArtifacts.map((file) => writeFixtureFile(file)),
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
    await expectMissing(windowsBuildDepsArtifact);
    await Promise.all(windowsDebugArtifacts.map((file) => expectMissing(file)));
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
    const windowsBuildArtifacts = [
      "build/Release/better_sqlite3.iobj",
      "build/Release/better_sqlite3.ipdb",
      "build/Release/better_sqlite3.pdb",
      "build/Release/sqlite3.lib",
      "build/Release/test_extension.pdb",
      "build/Release/test_extension.node",
    ].map((file) => path.join(betterSqlitePath, file));

    await Promise.all([
      writeFixtureFile(runtimeJs),
      writeFixtureFile(runtimeBinary),
      writeFixtureFile(sqliteSource),
      writeFixtureFile(staticLibrary),
      writeFixtureFile(buildObject),
      ...windowsBuildArtifacts.map((file) => writeFixtureFile(file)),
      writeFixtureFile(path.join(betterSqlitePath, "src/addon.cpp")),
    ]);

    await removeUnusedAppPackageFiles(buildPath, "darwin", "arm64");

    await expect(fs.readFile(runtimeJs, "utf8")).resolves.toBe("fixture");
    await expect(fs.readFile(runtimeBinary, "utf8")).resolves.toBe("fixture");
    await expectMissing(sqliteSource);
    await expectMissing(staticLibrary);
    await expectMissing(buildObject);
    await Promise.all(windowsBuildArtifacts.map((file) => expectMissing(file)));
    await expectMissing(path.join(betterSqlitePath, "src/addon.cpp"));
  });

  it("keeps keychain reader runtime files and removes build intermediates", async () => {
    const buildPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-package-cleanup-keychain-"),
    );
    tempDirectories.push(buildPath);

    const keychainReaderPath = path.join(
      buildPath,
      "node_modules/dyad-keychain-reader",
    );
    const runtimeJs = path.join(keychainReaderPath, "index.js");
    const runtimeBinary = path.join(
      keychainReaderPath,
      "build/Release/keychain_reader.node",
    );
    const sourceFile = path.join(keychainReaderPath, "src/keychain_reader.c");
    const buildObject = path.join(
      keychainReaderPath,
      "build/Release/obj.target/keychain_reader/src/keychain_reader.o",
    );
    const debugSymbols = path.join(
      keychainReaderPath,
      "build/Release/keychain_reader.pdb",
    );

    await Promise.all([
      writeFixtureFile(runtimeJs),
      writeFixtureFile(runtimeBinary),
      writeFixtureFile(sourceFile),
      writeFixtureFile(buildObject),
      writeFixtureFile(debugSymbols),
      writeFixtureFile(path.join(keychainReaderPath, "binding.gyp")),
    ]);

    await removeUnusedAppPackageFiles(buildPath, "darwin", "arm64");

    await expect(fs.readFile(runtimeJs, "utf8")).resolves.toBe("fixture");
    await expect(fs.readFile(runtimeBinary, "utf8")).resolves.toBe("fixture");
    await expectMissing(sourceFile);
    await expectMissing(buildObject);
    await expectMissing(debugSymbols);
    await expectMissing(path.join(keychainReaderPath, "binding.gyp"));
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

  it("removes Git Credential Manager from the Unix git distribution but keeps git's own files", async () => {
    const buildPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-package-cleanup-gcm-unix-"),
    );
    tempDirectories.push(buildPath);

    const gitCorePath = path.join(
      buildPath,
      "dyad.app/Contents/Resources/git/libexec/git-core",
    );

    const removedFiles = [
      "git-credential-manager",
      "git-credential-manager.dll",
      "git-credential-manager.deps.json",
      "git-credential-manager.runtimeconfig.json",
      "System.Private.CoreLib.dll",
      "Avalonia.Base.dll",
      "libcoreclr.dylib",
      "libSkiaSharp.dylib",
      "libSystem.Native.dylib",
      "createdump",
      // .NET satellite assembly in a locale subdirectory
      "ja/System.CommandLine.resources.dll",
    ].map((file) => path.join(gitCorePath, file));

    const keptFiles = [
      "git",
      "git-credential",
      "git-credential-store",
      "git-credential-cache",
      "git-remote-https",
      "mergetools/vimdiff",
    ].map((file) => path.join(gitCorePath, file));

    await Promise.all(
      [...removedFiles, ...keptFiles].map((file) => writeFixtureFile(file)),
    );

    await removeUnusedCopiedResources(buildPath, "darwin");

    await Promise.all(removedFiles.map((file) => expectMissing(file)));
    // The emptied GCM locale directory is removed as well
    await expectMissing(path.join(gitCorePath, "ja"));
    for (const file of keptFiles) {
      await expect(fs.readFile(file, "utf8")).resolves.toBe("fixture");
    }
  });

  it("surfaces unexpected errors when removing empty Unix GCM locale directories", async () => {
    const buildPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-package-cleanup-gcm-rmdir-"),
    );
    tempDirectories.push(buildPath);

    const gitCorePath = path.join(
      buildPath,
      "dyad.app/Contents/Resources/git/libexec/git-core",
    );
    await writeFixtureFile(
      path.join(gitCorePath, "ja/System.CommandLine.resources.dll"),
    );

    const error = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    const rmdirSpy = vi.spyOn(fs, "rmdir").mockRejectedValueOnce(error);

    await expect(removeUnusedCopiedResources(buildPath, "darwin")).rejects.toBe(
      error,
    );

    rmdirSpy.mockRestore();
  });

  it("removes Git Credential Manager and git-lfs from the Windows git distribution but keeps git's DLLs", async () => {
    const buildPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-package-cleanup-gcm-win-"),
    );
    tempDirectories.push(buildPath);

    const gitPath = path.join(buildPath, "resources/git");
    const binPath = path.join(gitPath, "mingw64/bin");

    const removedFiles = [
      "git-credential-manager.exe",
      "git-credential-manager.exe.config",
      "git-credential-helper-selector.exe",
      "gcmcore.dll",
      "GitHub.dll",
      "Atlassian.Bitbucket.dll",
      "Avalonia.dll",
      "Avalonia.Markup.Xaml.dll",
      "av_libglesv2.dll",
      "Microsoft.Identity.Client.dll",
      "System.CommandLine.dll",
      "MicroCom.Runtime.dll",
      "SkiaSharp.dll",
      "libSkiaSharp.dll",
      "HarfBuzzSharp.dll",
      "msalruntime_x86.dll",
      "scalar.exe",
    ].map((file) => path.join(binPath, file));

    const keptFiles = [
      "git.exe",
      "git-remote-https.exe",
      "libcurl-4.dll",
      "libssl-3-x64.dll",
      "libpcre2-8-0.dll",
      "zlib1.dll",
    ].map((file) => path.join(binPath, file));

    const gitLfs = path.join(gitPath, "mingw64/libexec/git-core/git-lfs.exe");
    const cmdScalar = path.join(gitPath, "cmd/scalar.exe");
    const gitconfig = path.join(gitPath, "etc/gitconfig");

    await Promise.all([
      ...[...removedFiles, ...keptFiles, gitLfs, cmdScalar].map((file) =>
        writeFixtureFile(file),
      ),
      writeFixtureFile(
        gitconfig,
        "[core]\n\tsymlinks = false\n[credential]\n\thelper = manager\n[http]\n\tsslBackend = schannel\n",
      ),
    ]);

    await removeUnusedCopiedResources(buildPath, "win32");

    await Promise.all(removedFiles.map((file) => expectMissing(file)));
    await expectMissing(gitLfs);
    await expectMissing(cmdScalar);
    for (const file of keptFiles) {
      await expect(fs.readFile(file, "utf8")).resolves.toBe("fixture");
    }
    const scrubbedConfig = await fs.readFile(gitconfig, "utf8");
    expect(scrubbedConfig).not.toContain("helper = manager");
    expect(scrubbedConfig).toContain("symlinks = false");
    expect(scrubbedConfig).toContain("sslBackend = schannel");
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
