import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  filterPostHogCliEnv,
  POSTHOG_CLI_BINARY_SHA256,
  POSTHOG_CLI_VERSION,
  posthogHiddenSourcemapsPlugin,
  uploadPostHogSourcemaps,
} from "@/lib/posthog_sourcemaps";

const CREDENTIALS = {
  POSTHOG_CLI_API_KEY: "phx_test",
  POSTHOG_CLI_PROJECT_ID: "123",
};
const ENABLED = { POSTHOG_UPLOAD_SOURCEMAPS: "true", ...CREDENTIALS };
const CLI_DIR = "/repo/node_modules/@posthog/cli";

function upload(
  env: NodeJS.ProcessEnv,
  {
    hostPlatform = "linux-x64",
    binaryHash = POSTHOG_CLI_BINARY_SHA256["linux-x64"],
    runCli = vi.fn().mockResolvedValue(undefined),
  } = {},
) {
  const resolveCliPackageDir = vi.fn(() => CLI_DIR);
  const hashFile = vi.fn().mockResolvedValue(binaryHash);
  const result = uploadPostHogSourcemaps({
    buildPath: "/tmp/build/app",
    releaseVersion: "1.2.3",
    resolveCliPackageDir,
    env,
    hostPlatform,
    hashFile,
    runCli,
  });
  return { result, runCli, resolveCliPackageDir, hashFile };
}

describe("posthogHiddenSourcemapsPlugin", () => {
  it("leaves the build untouched unless uploads are enabled", () => {
    expect(posthogHiddenSourcemapsPlugin({})).toEqual([]);
    expect(
      posthogHiddenSourcemapsPlugin({ POSTHOG_UPLOAD_SOURCEMAPS: "1" }),
    ).toEqual([]);
  });

  it("emits hidden source maps when uploads are enabled", () => {
    const [plugin] = posthogHiddenSourcemapsPlugin({
      POSTHOG_UPLOAD_SOURCEMAPS: "true",
    });
    const config = plugin.config as () => unknown;
    expect(config()).toEqual({ build: { sourcemap: "hidden" } });
  });
});

describe("uploadPostHogSourcemaps", () => {
  it("does nothing without the opt-in flag, even with credentials", async () => {
    const { result, runCli, resolveCliPackageDir, hashFile } =
      upload(CREDENTIALS);
    await expect(result).resolves.toBeUndefined();
    expect(runCli).not.toHaveBeenCalled();
    expect(resolveCliPackageDir).not.toHaveBeenCalled();
    expect(hashFile).not.toHaveBeenCalled();
  });

  it.each(["POSTHOG_CLI_API_KEY", "POSTHOG_CLI_PROJECT_ID"])(
    "fails the build when opted in without %s",
    async (missing) => {
      const env: NodeJS.ProcessEnv = { ...ENABLED };
      delete env[missing];
      const { result, runCli } = upload(env);
      await expect(result).rejects.toThrow(missing);
      expect(runCli).not.toHaveBeenCalled();
    },
  );

  it("injects chunk IDs, then uploads and removes the local maps", async () => {
    const { result, runCli, hashFile } = upload(ENABLED);
    await result;

    const binary = path.join(
      CLI_DIR,
      "node_modules",
      ".bin_real",
      "posthog-cli",
    );
    expect(hashFile).toHaveBeenCalledWith(binary);
    const directory = path.join("/tmp/build/app", ".vite");
    const release = ["--release-name", "dyad", "--release-version", "1.2.3"];
    expect(runCli.mock.calls.map(([bin, args]) => [bin, args])).toEqual([
      [binary, ["sourcemap", "inject", "--directory", directory, ...release]],
      [
        binary,
        [
          "sourcemap",
          "upload",
          "--directory",
          directory,
          "--delete-after",
          ...release,
        ],
      ],
    ]);
  });

  it("runs the .exe binary on Windows", async () => {
    const { result, runCli } = upload(ENABLED, {
      hostPlatform: "win32-x64",
      binaryHash: POSTHOG_CLI_BINARY_SHA256["win32-x64"],
    });
    await result;
    expect(runCli.mock.calls[0][0]).toBe(
      path.join(CLI_DIR, "node_modules", ".bin_real", "posthog-cli.exe"),
    );
  });

  it("refuses to run a binary whose hash does not match the pin", async () => {
    const { result, runCli } = upload(ENABLED, { binaryHash: "0".repeat(64) });
    await expect(result).rejects.toThrow("refusing to run it");
    expect(runCli).not.toHaveBeenCalled();
  });

  it("refuses to run on a platform without a pinned hash", async () => {
    const { result, runCli, hashFile } = upload(ENABLED, {
      hostPlatform: "linux-arm64",
    });
    await expect(result).rejects.toThrow("linux-arm64");
    expect(hashFile).not.toHaveBeenCalled();
    expect(runCli).not.toHaveBeenCalled();
  });

  it("passes the CLI only the allowlisted environment", async () => {
    const { result, runCli } = upload({
      ...ENABLED,
      APPLE_PASSWORD: "secret",
      GITHUB_TOKEN: "ghs_secret",
    });
    await result;
    for (const [, , env] of runCli.mock.calls) {
      expect(env).toEqual(CREDENTIALS);
    }
  });

  it("does not upload when injection fails", async () => {
    const runCli = vi.fn().mockRejectedValue(new Error("inject failed"));
    const { result } = upload(ENABLED, { runCli });
    await expect(result).rejects.toThrow("inject failed");
    expect(runCli).toHaveBeenCalledTimes(1);
  });
});

describe("filterPostHogCliEnv", () => {
  it("keeps PostHog, system, and proxy variables in any case, and drops the rest", () => {
    expect(
      filterPostHogCliEnv({
        POSTHOG_CLI_API_KEY: "phx",
        POSTHOG_CLI_HOST: "https://us.posthog.com",
        Path: "C:\\Windows",
        SystemRoot: "C:\\Windows",
        https_proxy: "http://proxy",
        HOME: "/home/runner",
        AZURE_CLIENT_SECRET: "secret",
        APPLE_ID: "me@example.com",
        GITHUB_TOKEN: "ghs",
        NODE_OPTIONS: "--max-old-space-size=6144",
        POSTHOG_UPLOAD_SOURCEMAPS: "true",
      }),
    ).toEqual({
      POSTHOG_CLI_API_KEY: "phx",
      POSTHOG_CLI_HOST: "https://us.posthog.com",
      Path: "C:\\Windows",
      SystemRoot: "C:\\Windows",
      https_proxy: "http://proxy",
      HOME: "/home/runner",
    });
  });
});

describe("pinned posthog-cli binary", () => {
  it("matches the @posthog/cli version in package.json", () => {
    // Bumping @posthog/cli requires updating POSTHOG_CLI_BINARY_SHA256 too.
    const packageJson = JSON.parse(
      readFileSync(path.join(__dirname, "../../package.json"), "utf8"),
    ) as { devDependencies: Record<string, string> };
    expect(packageJson.devDependencies["@posthog/cli"]).toBe(
      POSTHOG_CLI_VERSION,
    );
  });

  it("pins every release runner platform", () => {
    expect(Object.keys(POSTHOG_CLI_BINARY_SHA256).sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-x64",
      "win32-x64",
    ]);
    for (const hash of Object.values(POSTHOG_CLI_BINARY_SHA256)) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
