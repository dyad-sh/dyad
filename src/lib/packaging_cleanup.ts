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

// dugite-native's git distribution bundles Git Credential Manager (GCM), a
// self-contained .NET application. Dyad never invokes it: git auth is handled
// with access tokens and credential helpers are explicitly disabled. GCM and
// its runtime account for ~105MB on macOS, ~83MB on Linux, and ~26MB on
// Windows, so it is pruned from the packaged app.

// On macOS/Linux, GCM lives in git/libexec/git-core as a .NET app: managed
// assemblies (*.dll, including locale subdirectories with satellite
// *.resources.dll), the CoreCLR native runtime, and GCM's UI libraries.
// No file shipped by git itself matches these names on Unix.
const UNIX_GCM_NATIVE_LIB_PREFIXES = [
  "libAvaloniaNative.",
  "libclrgc.",
  "libclrjit.",
  "libcoreclr.",
  "libHarfBuzzSharp.",
  "libhostfxr.",
  "libhostpolicy.",
  "libmscordaccore.",
  "libmscordbi.",
  "libSkiaSharp.",
  "libSystem.",
] as const;

function isUnixGcmFile(name: string): boolean {
  // This predicate is applied recursively under git/libexec/git-core. Dugite's
  // current Unix git subdirectories only contain scripts or GCM satellite
  // assemblies; audit this sweep when upgrading dugite's bundled git layout.
  return (
    name.endsWith(".dll") ||
    name.endsWith(".deps.json") ||
    name.endsWith(".runtimeconfig.json") ||
    name === "git-credential-manager" ||
    // CoreCLR crash-dump helper
    name === "createdump" ||
    UNIX_GCM_NATIVE_LIB_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

// On Windows (minGit), GCM lives in <mingw>/bin alongside DLLs git itself
// needs (libcurl, libssl, libpcre2, ...), so removal is limited to GCM's own
// binaries and its .NET/Avalonia/MSAL dependencies. lib*.dll names are NOT
// blanket-matched.
const WINDOWS_GCM_FILE_PATTERNS: readonly RegExp[] = [
  /^git-credential-manager\.exe(\.config)?$/,
  /^git-credential-helper-selector\.exe$/,
  /^gcmcore\.dll$/,
  /^(GitHub|GitLab)\.dll$/,
  /^Atlassian\..+\.dll$/,
  /^Avalonia(\..+)?\.dll$/,
  /^av_libglesv2\.dll$/,
  /^(Microsoft|System)\..+\.dll$/,
  /^MicroCom\.Runtime\.dll$/,
  /^(lib)?SkiaSharp\.dll$/,
  /^(lib)?HarfBuzzSharp\.dll$/,
  /^msalruntime.*\.dll$/,
  /^netstandard\.dll$/,
  /^mscorlib\.dll$/,
  /^Newtonsoft\.Json\.dll$/,
] as const;

// minGit subfolder varies by arch (see dugite's git-environment).
const WINDOWS_MINGW_SUBFOLDERS = ["mingw64", "mingw32", "clangarm64"] as const;

async function removeEmptyDirectories(basePath: string): Promise<void> {
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

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(entry.parentPath, entry.name))
    // Deepest first so emptied parents can be removed too
    .sort((a, b) => b.length - a.length);

  for (const directory of directories) {
    try {
      await fs.rmdir(directory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTEMPTY" || code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
}

async function pruneGitCredentialManagerUnix(gitPath: string): Promise<void> {
  const gitCorePath = path.join(gitPath, "libexec", "git-core");
  await removeFilesMatching(gitCorePath, ({ name }) => isUnixGcmFile(name));
  // GCM locale directories (cs, de, ja, ...) only held satellite
  // *.resources.dll files and are empty after the sweep.
  await removeEmptyDirectories(gitCorePath);
}

async function pruneGitCredentialManagerWindows(
  gitPath: string,
): Promise<void> {
  await Promise.all(
    WINDOWS_MINGW_SUBFOLDERS.map((subfolder) =>
      removeFilesMatching(path.join(gitPath, subfolder, "bin"), ({ name }) =>
        WINDOWS_GCM_FILE_PATTERNS.some((pattern) => pattern.test(name)),
      ),
    ),
  );

  // minGit's system gitconfig sets credential.helper=manager; drop the line so
  // git does not warn about (or attempt to launch) the removed helper.
  const gitconfigPath = path.join(gitPath, "etc", "gitconfig");
  let original: string;
  try {
    original = await fs.readFile(gitconfigPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  const scrubbed = original
    .split("\n")
    .filter((line) => !/^\s*helper\s*=\s*manager\s*\r?$/.test(line))
    .join("\n");
  if (scrubbed !== original) {
    await fs.writeFile(gitconfigPath, scrubbed, "utf8");
  }
}

async function pruneGitDistribution(
  resourcesPath: string,
  platform: PackagerPlatform,
): Promise<void> {
  const gitPath = path.join(resourcesPath, "git");
  if (platform === "win32") {
    await pruneGitCredentialManagerWindows(gitPath);
    // git-lfs (unused by Dyad; removed on Unix below)
    await Promise.all(
      WINDOWS_MINGW_SUBFOLDERS.map((subfolder) =>
        rmIfExists(
          path.join(gitPath, subfolder, "libexec", "git-core", "git-lfs.exe"),
        ),
      ),
    );
    return;
  }
  await pruneGitCredentialManagerUnix(gitPath);
  await rmIfExists(path.join(gitPath, "libexec", "git-core", "git-lfs"));
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
    pruneGitDistribution(appResourcesPath, platform),
    ...electronLocaleResourcePaths.flatMap((localeResourcePath) => [
      pruneElectronLocaleDirectories(localeResourcePath),
      pruneElectronLocalePaks(localeResourcePath),
    ]),
  ]);
}
