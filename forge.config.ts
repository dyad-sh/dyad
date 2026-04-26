import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

// Path to signtool.exe bundled with electron-winstaller
// On GitHub Actions, this is the full path to the signtool binary.
const SIGNTOOL_PATH = path.join(
  __dirname,
  "node_modules",
  "electron-winstaller",
  "vendor",
  "signtool.exe",
);

/**
 * Signs a Windows executable using DigiCert's signtool.
 */
function signWindowsExecutable(filePath: string): void {
  const certHash = process.env.SM_CODE_SIGNING_CERT_SHA1_HASH;
  if (!certHash) {
    console.log(
      `[postMake] SM_CODE_SIGNING_CERT_SHA1_HASH not set, skipping signing`,
    );
    return;
  }

  console.log(`[postMake] Signing: ${filePath}`);
  const signParams = `/sha1 ${certHash} /tr http://timestamp.digicert.com /td SHA256 /fd SHA256`;
  const cmd = `"${SIGNTOOL_PATH}" sign ${signParams} "${filePath}"`;

  try {
    execSync(cmd, { stdio: "inherit" });
    console.log(`[postMake] Signing successful: ${filePath}`);
  } catch (error) {
    console.error(`[postMake] Signing failed for ${filePath}:`, error);
    throw error;
  }
}

// Based on https://github.com/electron/forge/blob/6b2d547a7216c30fde1e1fddd1118eee5d872945/packages/plugin/vite/src/VitePlugin.ts#L124

// Runtime-required dependencies that vite externalizes from the main bundle.
// We use the full production-dependency closure from package.json — that way
// any package that vite/rollup externalizes (explicitly or implicitly) will be
// present in node_modules at runtime, avoiding "Cannot find module 'X'"
// crashes in the packaged main process.
function getProductionDependencies(): string[] {
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "package.json"), "utf8"),
  );
  return Object.keys(pkgJson.dependencies || {});
}
const EXTERNAL_RUNTIME_PACKAGES = getProductionDependencies();

// Resolve the full transitive dependency closure of the externalized packages.
// Without this, packaging would only include the top-level package and runtime
// would fail with "Cannot find module 'X'" for any transitive dep.
function resolvePackageDir(name: string, fromDir: string): string | null {
  let dir = fromDir;
  while (true) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function computeRuntimeDepClosure(roots: string[]): Set<string> {
  // Collect set of allow-prefixes (relative to project root, with leading "/")
  // covering every directory in the dep closure, including nested node_modules.
  const allowPrefixes = new Set<string>();
  // Set of exact directory paths that must be traversable (parent dirs of any
  // package in the closure). For these we allow the exact path but do NOT
  // recursively allow children — children are gated by their own prefix entry.
  const allowExact = new Set<string>();
  const visited = new Set<string>(); // paths
  const projectRoot = __dirname;

  const addAllowPrefix = (rel: string) => {
    allowPrefixes.add(rel);
    // Also allow every ancestor directory exactly so packager can traverse to
    // it (e.g. `/node_modules/@pinojs` for `/node_modules/@pinojs/redact`).
    let p = rel;
    while (true) {
      const idx = p.lastIndexOf("/");
      if (idx <= 0) break;
      p = p.substring(0, idx);
      allowExact.add(p);
    }
  };

  const visit = (name: string, fromDir: string) => {
    const dir = resolvePackageDir(name, fromDir);
    if (!dir) return;
    if (visited.has(dir)) return;
    visited.add(dir);
    const rel = "/" + path.relative(projectRoot, dir).split(path.sep).join("/");
    addAllowPrefix(rel);
    let pkg: {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {
      return;
    }
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.optionalDependencies || {}),
    };
    for (const d of Object.keys(deps)) visit(d, dir);
  };
  for (const r of roots) visit(r, projectRoot);
  // Stash exact set on the prefix set object for the ignore filter to use.
  (allowPrefixes as Set<string> & { __exact?: Set<string> }).__exact = allowExact;
  return allowPrefixes;
}

const EXTERNAL_RUNTIME_DEP_CLOSURE = computeRuntimeDepClosure(
  EXTERNAL_RUNTIME_PACKAGES,
);
console.log(
  `[forge.config] Including ${EXTERNAL_RUNTIME_DEP_CLOSURE.size} package directories in asar (externalized + transitive deps)`,
);

const ignore = (file: string) => {
  if (!file) return false;
  // `file` always starts with `/`
  // @see - https://github.com/electron/packager/blob/v18.1.3/src/copy-filter.ts#L89-L93
  if (file === "/node_modules") {
    return false;
  }
  if (file.startsWith("/drizzle")) {
    return false;
  }
  if (file.startsWith("/scaffold")) {
    return false;
  }

  if (file.startsWith("/worker") && !file.startsWith("/workers")) {
    return false;
  }
  if (file.startsWith("/node_modules/stacktrace-js")) {
    return false;
  }
  if (file.startsWith("/node_modules/stacktrace-js/dist")) {
    return false;
  }
  if (file.startsWith("/node_modules/html-to-image")) {
    return false;
  }
  if (file.startsWith("/node_modules/better-sqlite3")) {
    return false;
  }
  if (file.startsWith("/node_modules/bindings")) {
    return false;
  }
  if (file.startsWith("/node_modules/file-uri-to-path")) {
    return false;
  }
  if (file.startsWith("/.vite")) {
    return false;
  }
  // Packages externalized in vite.main.config.mts must be present in
  // node_modules at runtime, otherwise the main process throws
  // "Cannot find module 'X'" before the window can load.
  const exact = (
    EXTERNAL_RUNTIME_DEP_CLOSURE as Set<string> & { __exact?: Set<string> }
  ).__exact;
  if (exact && exact.has(file)) {
    return false;
  }
  for (const prefix of EXTERNAL_RUNTIME_DEP_CLOSURE) {
    if (file === prefix || file.startsWith(prefix + "/")) {
      return false;
    }
  }

  return true;
};

const isEndToEndTestBuild = process.env.E2E_TEST_BUILD === "true";

const config: ForgeConfig = {
  outDir: "out-new",
  packagerConfig: {
    protocols: [
      {
        name: "JoyCreate",
        schemes: ["joycreate"],
      },
    ],
    icon: "./assets/icon/logo",

    osxSign: isEndToEndTestBuild
      ? undefined
      : {
          identity: process.env.APPLE_TEAM_ID,
        },
    osxNotarize: isEndToEndTestBuild
      ? undefined
      : {
          appleId: process.env.APPLE_ID!,
          appleIdPassword: process.env.APPLE_PASSWORD!,
          teamId: process.env.APPLE_TEAM_ID!,
        },
    asar: true,
    ignore,
    extraResource: ["node_modules/dugite/git"],
    // ignore: [/node_modules\/(?!(better-sqlite3|bindings|file-uri-to-path)\/)/],
  },
  rebuildConfig: {
    extraModules: ["better-sqlite3"],
    force: true,
    // Only rebuild the top-level better-sqlite3, not nested ones in n8n-nodes-langchain
    onlyModules: ["better-sqlite3"],
  },
  hooks: {
    postMake: async (_forgeConfig, makeResults) => {
      for (const result of makeResults) {
        // Only sign Windows artifacts
        if (result.platform !== "win32") {
          continue;
        }

        console.log(
          `[postMake] Processing Windows artifacts for ${result.arch}`,
        );
        for (const artifact of result.artifacts) {
          const fileName = path.basename(artifact).toLowerCase();
          // Sign .exe files (the Squirrel installer and Setup.exe)
          if (fileName.endsWith(".exe")) {
            signWindowsExecutable(artifact);
          }
        }
      }
      return makeResults;
    },
  },
  makers: [
    new MakerSquirrel({
      setupIcon: "./assets/icon/logo.ico",
      iconUrl:
        "https://raw.githubusercontent.com/DisciplesofLove/JoyCreate/main/assets/icon/logo.ico",
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({
      options: {
        mimeType: ["x-scheme-handler/joycreate"],
      },
    }),
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "DisciplesofLove",
          name: "JoyCreate",
        },
        draft: true,
        force: true,
        prerelease: true,
      },
    },
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // Disable concurrent builds to prevent resource contention on Windows
      // when building the large main process bundle (3800+ modules)
      concurrent: false,
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main.ts",
          config: "vite.main.config.mts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.mts",
          target: "preload",
        },
        {
          entry: "workers/tsc/tsc_worker.ts",
          config: "vite.worker.config.mts",
          target: "main",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]:
        isEndToEndTestBuild || process.env.JOY_DEBUG_BUILD === "1",
      // Asar integrity validation requires the binary to be signed with
      // @electron/windows-sign so the integrity blocks are embedded in the
      // .exe resources. For unsigned local builds this causes loadFile from
      // asar to fail silently (window opens with title "Error"). Disable for
      // unsigned local builds; CI/release builds re-enable via env var.
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
        process.env.JOY_SIGN_WINDOWS === "1",
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
