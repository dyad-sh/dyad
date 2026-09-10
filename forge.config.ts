import { windowsSign } from "./windowsSign";
import {
  removeUnusedAppPackageFiles,
  removeUnusedCopiedResources,
} from "./src/lib/packaging_cleanup";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerAppImage } from "./makers/MakerAppImage";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { readFileSync } from "fs";
import { createRequire } from "module";

console.log("AZURE_CODE_SIGNING_DLIB", process.env.AZURE_CODE_SIGNING_DLIB);

const require = createRequire(import.meta.url);
const { isPrereleaseVersion } =
  require("./scripts/release-version-utils.js") as {
    isPrereleaseVersion: (version: string) => boolean;
  };
const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

const pgRuntimeDependencies = [
  "pg",
  "pg-cloudflare",
  "pg-connection-string",
  "pg-int8",
  "pg-pool",
  "pg-protocol",
  "pg-types",
  "pgpass",
  "postgres-array",
  "postgres-bytea",
  "postgres-date",
  "postgres-interval",
  "split2",
  "xtend",
] as const;

const ssh2RuntimeDependencies = [
  "ssh2",
  "asn1",
  "safer-buffer",
  "bcrypt-pbkdf",
  "tweetnacl",
] as const;

function isRuntimeDependency(file: string, packages: readonly string[]): boolean {
  return packages.some((dependency) => {
    const modulePath = `/node_modules/${dependency}`;
    return file === modulePath || file.startsWith(`${modulePath}/`);
  });
}

const ignore = (file: string) => {
  if (!file) return false;
  if (file === "/node_modules") return false;
  if (file.startsWith("/drizzle")) return false;
  if (file.startsWith("/scaffold")) return false;
  if (file.startsWith("/worker") && !file.startsWith("/workers")) return false;
  if (file.startsWith("/node_modules/stacktrace-js")) return false;
  if (file.startsWith("/node_modules/stacktrace-js/dist")) return false;
  if (file.startsWith("/node_modules/html-to-image")) return false;
  if (file.startsWith("/node_modules/better-sqlite3")) return false;
  if (file.startsWith("/node_modules/dyad-keychain-reader")) return false;
  if (file.startsWith("/node_modules/node-pty")) return false;
  if (isRuntimeDependency(file, ssh2RuntimeDependencies)) return false;
  if (file.startsWith("/node_modules/mustardscript")) return false;
  if (file.startsWith("/node_modules/@mustardscript")) return false;
  if (file.startsWith("/node_modules/node-addon-api")) return false;
  if (file.startsWith("/node_modules/bindings")) return false;
  if (file.startsWith("/node_modules/file-uri-to-path")) return false;
  if (file === "/node_modules/@typescript") return false;
  if (file.startsWith("/node_modules/@typescript/typescript6")) return false;
  if (file.startsWith("/node_modules/@typescript/old")) return false;
  if (isRuntimeDependency(file, pgRuntimeDependencies)) return false;
  if (file === "/node_modules/ws" || file.startsWith("/node_modules/ws/")) return false;
  if (file.startsWith("/.vite")) return false;
  return true;
};

const isEndToEndTestBuild = process.env.E2E_TEST_BUILD === "true";
const isWindowsSigningEnabled = process.env.WINDOWS_SIGN === "true";
const shouldSkipNativeRebuild = process.env.DYAD_SKIP_NATIVE_REBUILD === "true";
const nativeRebuildModules = [
  "better-sqlite3",
  "node-pty",
  "mustardscript",
  ...(process.platform === "darwin" ? ["dyad-keychain-reader"] : []),
];

if (isWindowsSigningEnabled && !process.env.AZURE_CODE_SIGNING_DLIB) {
  throw new Error(
    "WINDOWS_SIGN is enabled but AZURE_CODE_SIGNING_DLIB is not set. Ensure Azure Trusted Signing tools are installed.",
  );
}

const config: ForgeConfig = {
  packagerConfig: {
    derefSymlinks: true,
    windowsSign: isWindowsSigningEnabled ? windowsSign : undefined,
    afterCopy: [
      (buildPath, _electronVersion, platform, arch, callback) => {
        removeUnusedAppPackageFiles(buildPath, platform, arch).then(
          () => callback(),
          (error) => callback(error as Error),
        );
      },
    ],
    afterCopyExtraResources: [
      (buildPath, _electronVersion, platform, _arch, callback) => {
        removeUnusedCopiedResources(buildPath, platform).then(
          () => callback(),
          (error) => callback(error as Error),
        );
      },
    ],
    protocols: [
      {
        name: "Cat",
        schemes: ["cat", "dyad"],
      },
    ],
    icon: "./assets/icon/logo",
    osxSign: isEndToEndTestBuild
      ? undefined
      : ({
          identity: process.env.APPLE_TEAM_ID,
          continueOnError: false,
          preEmbedProvisioningProfile: false,
        } as Record<string, unknown>),
    osxNotarize: isEndToEndTestBuild
      ? undefined
      : {
          appleId: process.env.APPLE_ID!,
          appleIdPassword: process.env.APPLE_PASSWORD!,
          teamId: process.env.APPLE_TEAM_ID!,
        },
    asar: {
      unpackDir:
        "{node_modules/dyad-keychain-reader,node_modules/node-pty,node_modules/mustardscript,node_modules/@mustardscript}",
    },
    ignore,
    extraResource: ["node_modules/dugite/git", "node_modules/@vscode"],
  },
  rebuildConfig: shouldSkipNativeRebuild
    ? { onlyModules: [] }
    : { extraModules: nativeRebuildModules, force: true },
  makers: [
    new MakerSquirrel(
      // @ts-expect-error - incorrect types exported by MakerSquirrel
      isWindowsSigningEnabled
        ? {
            windowsSign,
            iconUrl:
              "https://raw.githubusercontent.com/Rahulchaube1/dyad/rebrand/cat-ui/assets/icon/logo.ico",
            setupIcon: "./assets/icon/logo.ico",
          }
        : {
            iconUrl:
              "https://raw.githubusercontent.com/Rahulchaube1/dyad/rebrand/cat-ui/assets/icon/logo.ico",
            setupIcon: "./assets/icon/logo.ico",
          },
    ),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({
      options: {
        mimeType: ["x-scheme-handler/cat", "x-scheme-handler/dyad"],
        icon: "./assets/icon/logo.png",
      },
    }),
    new MakerDeb({
      options: {
        mimeType: ["x-scheme-handler/cat", "x-scheme-handler/dyad"],
        icon: "./assets/icon/logo.png",
      },
    }),
    new MakerAppImage({ icon: "./assets/icon/logo.png" }),
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "Rahulchaube1",
          name: "dyad",
        },
        draft: true,
        force: true,
        prerelease: isPrereleaseVersion(packageJson.version),
      },
    },
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: "src/main_bootstrap.ts", config: "vite.main.config.mts", target: "main" },
        { entry: "src/preload.ts", config: "vite.preload.config.mts", target: "preload" },
        { entry: "workers/code_explorer/code_explorer_worker.ts", config: "vite.code-explorer-worker.config.mts", target: "main" },
        { entry: "workers/supabase_dependency_analysis/supabase_dependency_analysis_worker.ts", config: "vite.supabase-dependency-analysis-worker.config.mts", target: "main" },
        { entry: "src/ipc/utils/sandbox/sandbox_worker.ts", config: "vite.sandbox-worker.config.mts", target: "main" },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.mts" }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: isEndToEndTestBuild,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
