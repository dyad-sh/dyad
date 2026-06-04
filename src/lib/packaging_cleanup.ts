import fs from "node:fs/promises";
import path from "node:path";

type PackagerPlatform = "darwin" | "linux" | "mas" | "win32" | string;
type PackagerArch = "arm64" | "x64" | "ia32" | string;

const ELECTRON_LOCALE_DIRS_TO_KEEP = new Set([
  "en.lproj",
  "es.lproj",
  "pt_BR.lproj",
  "zh_CN.lproj",
]);

const ELECTRON_LOCALE_PAKS_TO_KEEP = new Set([
  "en-US.pak",
  "es.pak",
  "pt-BR.pak",
  "zh-CN.pak",
]);

const NODE_PTY_KEEP_PREBUILDS_BY_TARGET: Record<string, string | undefined> = {
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "mas-arm64": "darwin-arm64",
  "mas-x64": "darwin-x64",
  "win32-arm64": "win32-arm64",
  "win32-x64": "win32-x64",
};

const NODE_PTY_ALWAYS_REMOVE_RELATIVE_PATHS = [
  "README.md",
  "binding.gyp",
  "scripts",
  "src",
  "typings",
  "build/Makefile",
  "build/binding.Makefile",
  "build/config.gypi",
  "build/gyp-mac-tool",
  "build/Release/.deps",
  "build/Release/obj.target",
  "build/Release/obj",
] as const;

const BETTER_SQLITE3_REMOVE_RELATIVE_PATHS = [
  "README.md",
  "binding.gyp",
  "deps",
  "src",
  "test",
  "build/Makefile",
  "build/better_sqlite3.target.mk",
  "build/binding.Makefile",
  "build/config.gypi",
  "build/deps",
  "build/gyp-mac-tool",
  "build/Release/obj.target",
  "build/Release/obj",
  "build/Release/sqlite3.a",
] as const;

async function rmIfExists(absolutePath: string): Promise<void> {
  try {
    await fs.rm(absolutePath, { force: true, recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return;
    }
    throw error;
  }
}

async function removeRelativePaths(
  basePath: string,
  relativePaths: readonly string[],
): Promise<void> {
  await Promise.all(
    relativePaths.map((relativePath) =>
      rmIfExists(path.join(basePath, relativePath)),
    ),
  );
}

async function removeFilesMatching(
  basePath: string,
  predicate: (entry: { absolutePath: string; name: string }) => boolean,
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(basePath, {
      recursive: true,
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          predicate({
            absolutePath: path.join(entry.parentPath, entry.name),
            name: entry.name,
          }),
      )
      .map((entry) => rmIfExists(path.join(entry.parentPath, entry.name))),
  );
}

async function pruneNodePty(
  nodePtyPath: string,
  platform: PackagerPlatform,
  arch: PackagerArch,
): Promise<void> {
  await removeRelativePaths(nodePtyPath, NODE_PTY_ALWAYS_REMOVE_RELATIVE_PATHS);

  if (platform !== "win32") {
    await rmIfExists(path.join(nodePtyPath, "deps", "winpty"));
    await rmIfExists(path.join(nodePtyPath, "third_party", "conpty"));
  } else {
    await removeRelativePaths(nodePtyPath, [
      "deps/winpty/misc/ConinMode.ps1",
      "deps/winpty/misc/IdentifyConsoleWindow.ps1",
    ]);
  }

  await removeFilesMatching(
    nodePtyPath,
    ({ name }) =>
      name.endsWith(".pdb") || name.endsWith(".map") || name.includes(".test."),
  );

  const keepPrebuild = NODE_PTY_KEEP_PREBUILDS_BY_TARGET[`${platform}-${arch}`];
  const prebuildsPath = path.join(nodePtyPath, "prebuilds");
  let prebuilds: import("node:fs").Dirent[];
  try {
    prebuilds = await fs.readdir(prebuildsPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(
    prebuilds
      .filter((entry) => entry.isDirectory() && entry.name !== keepPrebuild)
      .map((entry) => rmIfExists(path.join(prebuildsPath, entry.name))),
  );
}

async function pruneBetterSqlite3(betterSqlite3Path: string): Promise<void> {
  await removeRelativePaths(
    betterSqlite3Path,
    BETTER_SQLITE3_REMOVE_RELATIVE_PATHS,
  );
}

export async function removeUnusedAppPackageFiles(
  appPath: string,
  platform: PackagerPlatform,
  arch: PackagerArch,
): Promise<void> {
  await Promise.all([
    pruneNodePty(
      path.join(appPath, "node_modules", "node-pty"),
      platform,
      arch,
    ),
    pruneBetterSqlite3(path.join(appPath, "node_modules", "better-sqlite3")),
  ]);
}

async function pruneElectronLocaleDirectories(
  resourcesPath: string,
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(resourcesPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.endsWith(".lproj") &&
          !ELECTRON_LOCALE_DIRS_TO_KEEP.has(entry.name),
      )
      .map((entry) => rmIfExists(path.join(resourcesPath, entry.name))),
  );
}

async function pruneElectronLocalePaks(resourcesPath: string): Promise<void> {
  const localesPath = path.join(resourcesPath, "locales");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(localesPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".pak") &&
          !ELECTRON_LOCALE_PAKS_TO_KEEP.has(entry.name),
      )
      .map((entry) => rmIfExists(path.join(localesPath, entry.name))),
  );
}

async function removeGitLfs(resourcesPath: string): Promise<void> {
  await rmIfExists(
    path.join(resourcesPath, "git", "libexec", "git-core", "git-lfs"),
  );
}

function getResourcePaths(
  buildPath: string,
  platform: PackagerPlatform,
): {
  appResourcesPath: string;
  electronLocaleResourcePaths: string[];
} {
  if (platform === "darwin" || platform === "mas") {
    return {
      appResourcesPath: path.join(
        buildPath,
        "dyad.app",
        "Contents",
        "Resources",
      ),
      electronLocaleResourcePaths: [
        path.join(
          buildPath,
          "dyad.app",
          "Contents",
          "Frameworks",
          "Electron Framework.framework",
          "Versions",
          "A",
          "Resources",
        ),
      ],
    };
  }

  return {
    appResourcesPath: path.join(buildPath, "resources"),
    electronLocaleResourcePaths: [path.join(buildPath, "resources"), buildPath],
  };
}

export async function removeUnusedCopiedResources(
  buildPath: string,
  platform: PackagerPlatform,
): Promise<void> {
  const { appResourcesPath, electronLocaleResourcePaths } = getResourcePaths(
    buildPath,
    platform,
  );

  await Promise.all([
    removeGitLfs(appResourcesPath),
    ...electronLocaleResourcePaths.flatMap((localeResourcePath) => [
      pruneElectronLocaleDirectories(localeResourcePath),
      pruneElectronLocalePaks(localeResourcePath),
    ]),
  ]);
}
