import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Release CI uploads source maps to PostHog error tracking so minified stack
 * traces from packaged builds resolve to original source. Local and PR builds
 * never set this flag and are unchanged. The flag only prevents accidental
 * uploads: the API key, which exists only as a release CI secret, is what
 * authorizes writing to Dyad's PostHog project.
 */
export const POSTHOG_UPLOAD_SOURCEMAPS_ENV = "POSTHOG_UPLOAD_SOURCEMAPS";

/** Read by posthog-cli itself. */
const REQUIRED_CLI_ENV = ["POSTHOG_CLI_API_KEY", "POSTHOG_CLI_PROJECT_ID"];

export const POSTHOG_RELEASE_NAME = "dyad";

/**
 * The @posthog/cli npm package is verified by package-lock.json, but its
 * postinstall downloads a native binary that nothing verifies. Pin each
 * release runner's binary so a tampered download fails the build instead of
 * running in the release job. When bumping @posthog/cli, update the version
 * and every hash (the SHA-256 of the extracted `posthog-cli` binary from
 * https://github.com/PostHog/posthog/releases/tag/posthog-cli/v<version>).
 */
export const POSTHOG_CLI_VERSION = "0.18.12";
export const POSTHOG_CLI_BINARY_SHA256: Readonly<Record<string, string>> = {
  "linux-x64":
    "c69b03b0d604662ed9939f9017d21e75652b6efe064e0118c6c4378c2f26bc06",
  "darwin-x64":
    "30618b24a8225b70c69348245e155c232bf2b283ade250531c6ba1e98e924cdb",
  "darwin-arm64":
    "78c21417f3e3d30a88af9970712ab115c303caec21ee3c8ab853a4320968adfa",
  "win32-x64":
    "3ba85040aaca852ab9c65f2256fc351d84925928c9a70fdb4248f0627543d774",
};

/**
 * The only environment the CLI binary receives, so it never sees the release
 * job's signing credentials or GitHub token. Matched case-insensitively,
 * because Windows environment names are (e.g. `Path`, `SystemRoot`).
 */
const CLI_ENV_ALLOWLIST = new Set(
  [
    "POSTHOG_CLI_API_KEY",
    "POSTHOG_CLI_PROJECT_ID",
    "POSTHOG_CLI_HOST",
    "PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
  ].map((name) => name.toUpperCase()),
);

export function filterPostHogCliEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) =>
        value !== undefined && CLI_ENV_ALLOWLIST.has(name.toUpperCase()),
    ),
  );
}

export function isPostHogSourcemapUploadEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[POSTHOG_UPLOAD_SOURCEMAPS_ENV] === "true";
}

/**
 * Makes a Vite build emit hidden source maps (no sourceMappingURL comment)
 * when uploads are enabled, for `uploadPostHogSourcemaps` to consume.
 */
export function posthogHiddenSourcemapsPlugin(
  env: NodeJS.ProcessEnv = process.env,
): Plugin[] {
  if (!isPostHogSourcemapUploadEnabled(env)) {
    return [];
  }
  return [
    {
      name: "dyad-posthog-hidden-sourcemaps",
      config: () => ({ build: { sourcemap: "hidden" } }),
    },
  ];
}

export interface UploadPostHogSourcemapsOptions {
  /** The packaged app directory, before it is archived into app.asar. */
  buildPath: string;
  releaseVersion: string;
  /**
   * Resolves the @posthog/cli package directory; called only when uploads are
   * enabled.
   */
  resolveCliPackageDir: () => string;
  env?: NodeJS.ProcessEnv;
  /** `${process.platform}-${process.arch}` of the machine running the build. */
  hostPlatform?: string;
  hashFile?: (filePath: string) => Promise<string>;
  runCli?: (
    binaryPath: string,
    args: string[],
    env: NodeJS.ProcessEnv,
  ) => Promise<void>;
}

/**
 * Runs from Forge's afterCopy hook, after Vite has written source maps into
 * `<buildPath>/.vite` and before the asar is created. Injects a chunk ID into
 * each shipped bundle, uploads the maps to PostHog, then removes the local map
 * files so they do not ship. Uploaded symbol sets stay in PostHog, so older
 * releases keep resolving.
 *
 * Chunk IDs are content-addressed (posthog-cli's default `event` release
 * mode), so re-uploading an identical build skips or overwrites matching
 * symbol sets instead of failing. That keeps release retries and redone
 * releases of the same version safe.
 */
export async function uploadPostHogSourcemaps({
  buildPath,
  releaseVersion,
  resolveCliPackageDir,
  env = process.env,
  hostPlatform = `${process.platform}-${process.arch}`,
  hashFile = sha256File,
  runCli = runBinary,
}: UploadPostHogSourcemapsOptions): Promise<void> {
  if (!isPostHogSourcemapUploadEnabled(env)) {
    return;
  }
  for (const name of REQUIRED_CLI_ENV) {
    if (!env[name]) {
      throw new Error(
        `${POSTHOG_UPLOAD_SOURCEMAPS_ENV}=true but ${name} is not set; refusing to package a release without uploading its source maps.`,
      );
    }
  }

  const expectedHash = POSTHOG_CLI_BINARY_SHA256[hostPlatform];
  if (!expectedHash) {
    throw new Error(
      `No pinned posthog-cli binary hash for ${hostPlatform}; source map uploads only run on the release runners (${Object.keys(POSTHOG_CLI_BINARY_SHA256).join(", ")}).`,
    );
  }
  // Run the verified binary directly. The package's JS wrapper would instead
  // re-download a missing binary on the spot, unverified.
  const binaryPath = path.join(
    resolveCliPackageDir(),
    "node_modules",
    ".bin_real",
    hostPlatform.startsWith("win32") ? "posthog-cli.exe" : "posthog-cli",
  );
  const actualHash = await hashFile(binaryPath);
  if (actualHash !== expectedHash) {
    throw new Error(
      `posthog-cli binary at ${binaryPath} has SHA-256 ${actualHash}, expected ${expectedHash} (posthog-cli ${POSTHOG_CLI_VERSION}, ${hostPlatform}); refusing to run it. If @posthog/cli was bumped, update POSTHOG_CLI_BINARY_SHA256.`,
    );
  }

  const cliEnv = filterPostHogCliEnv(env);
  const directory = path.join(buildPath, ".vite");
  const release = [
    "--release-name",
    POSTHOG_RELEASE_NAME,
    "--release-version",
    releaseVersion,
  ];
  await runCli(
    binaryPath,
    ["sourcemap", "inject", "--directory", directory, ...release],
    cliEnv,
  );
  await runCli(
    binaryPath,
    [
      "sourcemap",
      "upload",
      "--directory",
      directory,
      "--delete-after",
      ...release,
    ],
    cliEnv,
  );
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Spawns the native binary directly (not the node_modules/.bin shim, which is
 * a .cmd file on Windows), with only the allowlisted environment.
 */
function runBinary(
  binaryPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `posthog-cli ${args.slice(0, 2).join(" ")} failed (${signal ?? `exit code ${code}`})`,
        ),
      );
    });
  });
}
