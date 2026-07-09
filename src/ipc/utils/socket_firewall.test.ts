import { beforeEach, describe, expect, it, vi } from "vitest";
import { PtyCommandExecutionError } from "@/ipc/utils/pty_command_runner";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const { runPtyCommandMock } = vi.hoisted(() => ({
  runPtyCommandMock: vi.fn(),
}));

vi.mock("@/ipc/utils/pty_command_runner", async () => {
  const actual = await vi.importActual<
    typeof import("@/ipc/utils/pty_command_runner")
  >("@/ipc/utils/pty_command_runner");

  return {
    ...actual,
    runPtyCommand: runPtyCommandMock,
  };
});

import {
  buildPtyInvocation,
  buildAddDependencyCommand,
  detectPreferredPackageManager,
  DYAD_ALLOW_BUILDS_CACHE_TTL_MS,
  ensurePnpmAllowBuildsConfigured,
  ensureSocketFirewallInstalled,
  getBestEffortPnpmRebuildCommand,
  getManagedPnpmBinDir,
  getPackageManagerCommandEnv,
  getPnpmMinimumReleaseAgeSupport,
  PACKAGE_MANAGER_PROBE_TIMEOUT_MS,
  parsePnpmIgnoredBuildsFromModulesYaml,
  parsePnpmIgnoredBuildsFromOutput,
  readPnpmIgnoredBuilds,
  recordDeniedPnpmBuilds,
  resolveExecutableName,
  runCommand,
  SOCKET_FIREWALL_PROBE_TIMEOUT_MS,
  SOCKET_FIREWALL_WARNING_MESSAGE,
  updatePnpmAllowBuildsConfigContent,
  type CommandRunner,
  type PackageManager,
} from "./socket_firewall";

async function withPlatform<T>(
  platform: NodeJS.Platform,
  callback: () => Promise<T>,
): Promise<T> {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });

  try {
    return await callback();
  } finally {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPackageManagerCommandEnv", () => {
  it("disables Corepack project packageManager pins while preserving the rest of the env", () => {
    const managedPnpmBinDir = getManagedPnpmBinDir();
    const existingDir = os.tmpdir();

    expect(
      getPackageManagerCommandEnv({ PATH: existingDir, FOO: "bar" }),
    ).toEqual({
      PATH: [managedPnpmBinDir, existingDir].join(path.delimiter),
      FOO: "bar",
      COREPACK_ENABLE_PROJECT_SPEC: "0",
      COREPACK_ENABLE_STRICT: "0",
      npm_config_package_manager_strict: "false",
      npm_config_pm_on_fail: "ignore",
    });
  });

  it("does not duplicate the managed pnpm path segment", () => {
    const managedPnpmBinDir = getManagedPnpmBinDir();
    const pathValue = [managedPnpmBinDir, os.tmpdir()].join(path.delimiter);

    expect(getPackageManagerCommandEnv({ PATH: pathValue }).PATH).toBe(
      pathValue,
    );
  });

  it("promotes a non-front managed pnpm path segment and drops nonexistent path entries", () => {
    const managedPnpmBinDir = getManagedPnpmBinDir();
    const existingDir = os.tmpdir();
    const pathValue = ["/custom/node", managedPnpmBinDir, existingDir].join(
      path.delimiter,
    );

    expect(getPackageManagerCommandEnv({ PATH: pathValue }).PATH).toBe(
      [managedPnpmBinDir, existingDir].join(path.delimiter),
    );
  });

  it("drops empty PATH segments before prepending managed pnpm", () => {
    const managedPnpmBinDir = getManagedPnpmBinDir();
    const existingDir = os.tmpdir();
    const pathValue = [existingDir, "", "   "].join(path.delimiter);

    expect(getPackageManagerCommandEnv({ PATH: pathValue }).PATH).toBe(
      [managedPnpmBinDir, existingDir].join(path.delimiter),
    );
  });
});

describe("detectPreferredPackageManager", () => {
  it("prefers pnpm when available", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValue({ stdout: "10.16.0", stderr: "" });

    await expect(detectPreferredPackageManager(runner)).resolves.toBe("pnpm");
    expect(runner).toHaveBeenCalledWith("pnpm", ["--version"], {
      env: expect.objectContaining({
        COREPACK_ENABLE_PROJECT_SPEC: "0",
        COREPACK_ENABLE_STRICT: "0",
        npm_config_package_manager_strict: "false",
        npm_config_pm_on_fail: "ignore",
      }),
      timeoutMs: PACKAGE_MANAGER_PROBE_TIMEOUT_MS,
    });
  });

  it("falls back to npm when pnpm is unavailable", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockRejectedValue(new Error("ENOENT"));

    await expect(detectPreferredPackageManager(runner)).resolves.toBe("npm");
    expect(runner).toHaveBeenCalledWith("pnpm", ["--version"], {
      env: expect.objectContaining({
        COREPACK_ENABLE_PROJECT_SPEC: "0",
        COREPACK_ENABLE_STRICT: "0",
        npm_config_package_manager_strict: "false",
        npm_config_pm_on_fail: "ignore",
      }),
      timeoutMs: PACKAGE_MANAGER_PROBE_TIMEOUT_MS,
    });
  });

  it("prefers pnpm when pnpm is available but too old for minimumReleaseAge", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValue({ stdout: "10.15.0", stderr: "" });

    await expect(detectPreferredPackageManager(runner)).resolves.toBe("pnpm");
    expect(runner).toHaveBeenCalledWith("pnpm", ["--version"], {
      env: expect.objectContaining({
        COREPACK_ENABLE_PROJECT_SPEC: "0",
        COREPACK_ENABLE_STRICT: "0",
        npm_config_package_manager_strict: "false",
        npm_config_pm_on_fail: "ignore",
      }),
      timeoutMs: PACKAGE_MANAGER_PROBE_TIMEOUT_MS,
    });
  });

  it("reports old pnpm as available but not minimumReleaseAge-capable", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValue({ stdout: "10.15.0", stderr: "" });

    await expect(getPnpmMinimumReleaseAgeSupport(runner)).resolves.toEqual({
      available: true,
      minimumReleaseAgeSupported: false,
      version: "10.15.0",
      warningMessage:
        "Install pnpm 10.16.0 or newer for the strongest protection",
    });
  });

  it("reports missing pnpm as unavailable", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockRejectedValue(new Error("ENOENT"));

    await expect(getPnpmMinimumReleaseAgeSupport(runner)).resolves.toEqual({
      available: false,
      minimumReleaseAgeSupported: false,
      warningMessage:
        "Install pnpm 10.16.0 or newer for the strongest protection",
    });
  });
});

describe("updatePnpmAllowBuildsConfigContent", () => {
  const allowBuildsText = [
    "# dyad-default-allow-builds-schema=v1",
    "# dyad-default-allow-builds-data-version=2026-05-21.1",
    "# dyad-default-allow-builds-channel=local",
    "sharp",
    "@swc/core",
    "sharp",
    "",
  ].join("\n");

  it("creates allowBuilds config when no config exists", () => {
    expect(updatePnpmAllowBuildsConfigContent("", allowBuildsText)).toBe(
      [
        "allowBuilds:",
        "  # dyad-default-allow-builds begin",
        "  # dyad-default-allow-builds-schema=v1",
        "  # dyad-default-allow-builds-data-version=2026-05-21.1",
        "  # dyad-default-allow-builds-channel=local",
        '  "@swc/core": true',
        "  sharp: true",
        "  # dyad-default-allow-builds end",
        "",
        "packages:",
        "  - .",
        "minimumReleaseAge: 1440",
        "",
      ].join("\n"),
    );
  });

  it("inserts a managed block and minimumReleaseAge into existing config", () => {
    expect(
      updatePnpmAllowBuildsConfigContent(
        ["storeDir: /tmp/pnpm-store", "allowBuilds:", "  sharp: false"].join(
          "\n",
        ),
        allowBuildsText,
      ),
    ).toBe(
      [
        "storeDir: /tmp/pnpm-store",
        "allowBuilds:",
        "  # dyad-default-allow-builds begin",
        "  # dyad-default-allow-builds-schema=v1",
        "  # dyad-default-allow-builds-data-version=2026-05-21.1",
        "  # dyad-default-allow-builds-channel=local",
        '  "@swc/core": true',
        "  # dyad-default-allow-builds end",
        "  sharp: false",
        "",
        "packages:",
        "  - .",
        "minimumReleaseAge: 1440",
        "",
      ].join("\n"),
    );
  });

  it("preserves an existing minimumReleaseAge value", () => {
    expect(
      updatePnpmAllowBuildsConfigContent(
        ["minimumReleaseAge: 60", "allowBuilds:", "  sharp: false"].join("\n"),
        allowBuildsText,
      ),
    ).toBe(
      [
        "minimumReleaseAge: 60",
        "allowBuilds:",
        "  # dyad-default-allow-builds begin",
        "  # dyad-default-allow-builds-schema=v1",
        "  # dyad-default-allow-builds-data-version=2026-05-21.1",
        "  # dyad-default-allow-builds-channel=local",
        '  "@swc/core": true',
        "  # dyad-default-allow-builds end",
        "  sharp: false",
        "",
        "packages:",
        "  - .",
        "",
      ].join("\n"),
    );
  });

  it("replaces an existing managed block", () => {
    expect(
      updatePnpmAllowBuildsConfigContent(
        [
          "allowBuilds:",
          "  # dyad-default-allow-builds begin",
          "  # dyad-default-allow-builds-schema=v1",
          "  # dyad-default-allow-builds-data-version=2026-05-20.1",
          "  # dyad-default-allow-builds-channel=local",
          "  old-package: true",
          "  # dyad-default-allow-builds end",
        ].join("\n"),
        allowBuildsText,
      ),
    ).toBe(
      [
        "allowBuilds:",
        "  # dyad-default-allow-builds begin",
        "  # dyad-default-allow-builds-schema=v1",
        "  # dyad-default-allow-builds-data-version=2026-05-21.1",
        "  # dyad-default-allow-builds-channel=local",
        '  "@swc/core": true',
        "  sharp: true",
        "  # dyad-default-allow-builds end",
        "",
        "packages:",
        "  - .",
        "minimumReleaseAge: 1440",
        "",
      ].join("\n"),
    );
  });

  it("migrates an existing legacy managed block", () => {
    expect(
      updatePnpmAllowBuildsConfigContent(
        [
          "allowBuilds:",
          "  # dyad-default-allow-builds=v1 begin",
          "  old-package: true",
          "  # dyad-default-allow-builds=v1 end",
        ].join("\n"),
        allowBuildsText,
      ),
    ).toBe(
      [
        "allowBuilds:",
        "  # dyad-default-allow-builds begin",
        "  # dyad-default-allow-builds-schema=v1",
        "  # dyad-default-allow-builds-data-version=2026-05-21.1",
        "  # dyad-default-allow-builds-channel=local",
        '  "@swc/core": true',
        "  sharp: true",
        "  # dyad-default-allow-builds end",
        "",
        "packages:",
        "  - .",
        "minimumReleaseAge: 1440",
        "",
      ].join("\n"),
    );
  });

  it("rejects a source list without the expected sentinel", () => {
    expect(() =>
      updatePnpmAllowBuildsConfigContent("", "sharp\n@swc/core\n"),
    ).toThrow("Invalid default pnpm allow-builds list");
  });

  it("preserves an existing packages config", () => {
    expect(
      updatePnpmAllowBuildsConfigContent(
        ["packages:", "  - apps/*", "", "allowBuilds:"].join("\n"),
        allowBuildsText,
      ),
    ).toBe(
      [
        "packages:",
        "  - apps/*",
        "",
        "allowBuilds:",
        "  # dyad-default-allow-builds begin",
        "  # dyad-default-allow-builds-schema=v1",
        "  # dyad-default-allow-builds-data-version=2026-05-21.1",
        "  # dyad-default-allow-builds-channel=local",
        '  "@swc/core": true',
        "  sharp: true",
        "  # dyad-default-allow-builds end",
        "minimumReleaseAge: 1440",
        "",
      ].join("\n"),
    );
  });

  it("does not move YAML directives or document markers when adding packages", () => {
    expect(
      updatePnpmAllowBuildsConfigContent(
        [
          "%YAML 1.2",
          "---",
          "# existing config",
          "allowBuilds:",
          "  sharp: false",
        ].join("\n"),
        allowBuildsText,
      ),
    ).toBe(
      [
        "%YAML 1.2",
        "---",
        "# existing config",
        "allowBuilds:",
        "  # dyad-default-allow-builds begin",
        "  # dyad-default-allow-builds-schema=v1",
        "  # dyad-default-allow-builds-data-version=2026-05-21.1",
        "  # dyad-default-allow-builds-channel=local",
        '  "@swc/core": true',
        "  # dyad-default-allow-builds end",
        "  sharp: false",
        "",
        "packages:",
        "  - .",
        "minimumReleaseAge: 1440",
        "",
      ].join("\n"),
    );
  });

  it("writes project pnpm-workspace.yaml atomically", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dyad-pnpm-config-"));
    try {
      await expect(
        ensurePnpmAllowBuildsConfigured({
          appPath: tempDir,
          allowBuildsText,
        }),
      ).resolves.toEqual({ changed: true, promotedPackages: [] });

      await expect(
        readFile(path.join(tempDir, "pnpm-workspace.yaml"), "utf8"),
      ).resolves.toBe(
        [
          "allowBuilds:",
          "  # dyad-default-allow-builds begin",
          "  # dyad-default-allow-builds-schema=v1",
          "  # dyad-default-allow-builds-data-version=2026-05-21.1",
          "  # dyad-default-allow-builds-channel=local",
          '  "@swc/core": true',
          "  sharp: true",
          "  # dyad-default-allow-builds end",
          "",
          "packages:",
          "  - .",
          "minimumReleaseAge: 1440",
          "",
        ].join("\n"),
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes a valid fetched remote list", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dyad-pnpm-remote-"));
    const remoteAllowBuildsText = [
      "# dyad-default-allow-builds-schema=v1",
      "# dyad-default-allow-builds-data-version=2026-05-21.2",
      "# dyad-default-allow-builds-channel=remote",
      "esbuild",
      "@swc/core",
      "",
    ].join("\n");
    try {
      await expect(
        ensurePnpmAllowBuildsConfigured({
          appPath: tempDir,
          remoteAllowBuildsTextFetcher: vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(remoteAllowBuildsText),
          }),
        }),
      ).resolves.toEqual({ changed: true, promotedPackages: [] });

      await expect(
        readFile(path.join(tempDir, "pnpm-workspace.yaml"), "utf8"),
      ).resolves.toContain("  # dyad-default-allow-builds-channel=remote");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reuses a fetched remote list for one hour", async () => {
    const firstTempDir = await mkdtemp(
      path.join(os.tmpdir(), "dyad-pnpm-remote-cache-"),
    );
    const secondTempDir = await mkdtemp(
      path.join(os.tmpdir(), "dyad-pnpm-remote-cache-"),
    );
    const remoteAllowBuildsText = [
      "# dyad-default-allow-builds-schema=v1",
      "# dyad-default-allow-builds-data-version=2026-05-21.2",
      "# dyad-default-allow-builds-channel=remote",
      "esbuild",
      "",
    ].join("\n");
    const remoteAllowBuildsTextFetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(remoteAllowBuildsText),
    });

    try {
      await expect(
        ensurePnpmAllowBuildsConfigured({
          appPath: firstTempDir,
          remoteAllowBuildsTextFetcher,
        }),
      ).resolves.toEqual({ changed: true, promotedPackages: [] });
      await expect(
        ensurePnpmAllowBuildsConfigured({
          appPath: secondTempDir,
          remoteAllowBuildsTextFetcher,
        }),
      ).resolves.toEqual({ changed: true, promotedPackages: [] });

      expect(remoteAllowBuildsTextFetcher).toHaveBeenCalledTimes(1);
      await expect(
        readFile(path.join(secondTempDir, "pnpm-workspace.yaml"), "utf8"),
      ).resolves.toContain("  esbuild: true");
    } finally {
      await rm(firstTempDir, { recursive: true, force: true });
      await rm(secondTempDir, { recursive: true, force: true });
    }
  });

  it("refetches the remote list after the one-hour cache TTL", async () => {
    const firstTempDir = await mkdtemp(
      path.join(os.tmpdir(), "dyad-pnpm-remote-cache-expiry-"),
    );
    const secondTempDir = await mkdtemp(
      path.join(os.tmpdir(), "dyad-pnpm-remote-cache-expiry-"),
    );
    const firstRemoteAllowBuildsText = [
      "# dyad-default-allow-builds-schema=v1",
      "# dyad-default-allow-builds-data-version=2026-05-21.2",
      "# dyad-default-allow-builds-channel=remote",
      "esbuild",
      "",
    ].join("\n");
    const secondRemoteAllowBuildsText = [
      "# dyad-default-allow-builds-schema=v1",
      "# dyad-default-allow-builds-data-version=2026-05-21.3",
      "# dyad-default-allow-builds-channel=remote",
      "sharp",
      "",
    ].join("\n");
    const remoteAllowBuildsTextFetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(firstRemoteAllowBuildsText),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(secondRemoteAllowBuildsText),
      });
    const startMs = 1_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(startMs);

    try {
      await expect(
        ensurePnpmAllowBuildsConfigured({
          appPath: firstTempDir,
          remoteAllowBuildsTextFetcher,
        }),
      ).resolves.toEqual({ changed: true, promotedPackages: [] });

      dateNowSpy.mockReturnValue(startMs + DYAD_ALLOW_BUILDS_CACHE_TTL_MS + 1);

      await expect(
        ensurePnpmAllowBuildsConfigured({
          appPath: secondTempDir,
          remoteAllowBuildsTextFetcher,
        }),
      ).resolves.toEqual({ changed: true, promotedPackages: [] });

      expect(remoteAllowBuildsTextFetcher).toHaveBeenCalledTimes(2);
      await expect(
        readFile(path.join(secondTempDir, "pnpm-workspace.yaml"), "utf8"),
      ).resolves.toContain(
        "  # dyad-default-allow-builds-data-version=2026-05-21.3",
      );
    } finally {
      dateNowSpy.mockRestore();
      await rm(firstTempDir, { recursive: true, force: true });
      await rm(secondTempDir, { recursive: true, force: true });
    }
  });

  it("keeps an existing remote block when the remote list is unavailable", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "dyad-pnpm-existing-remote-"),
    );
    const configPath = path.join(tempDir, "pnpm-workspace.yaml");
    const existingConfig = [
      "packages:",
      "  - .",
      "",
      "allowBuilds:",
      "  # dyad-default-allow-builds begin",
      "  # dyad-default-allow-builds-schema=v1",
      "  # dyad-default-allow-builds-data-version=2026-05-21.2",
      "  # dyad-default-allow-builds-channel=remote",
      "  esbuild: true",
      "  # dyad-default-allow-builds end",
      "minimumReleaseAge: 1440",
      "",
    ].join("\n");
    try {
      await writeFile(configPath, existingConfig);

      await expect(
        ensurePnpmAllowBuildsConfigured({
          appPath: tempDir,
          remoteAllowBuildsTextFetcher: vi.fn().mockResolvedValue({
            ok: false,
            text: () => Promise.resolve(""),
          }),
        }),
      ).resolves.toEqual({ changed: false, promotedPackages: [] });

      await expect(readFile(configPath, "utf8")).resolves.toBe(existingConfig);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to the bundled local list when no remote block exists", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dyad-pnpm-local-"));
    try {
      await expect(
        ensurePnpmAllowBuildsConfigured({
          appPath: tempDir,
          remoteAllowBuildsTextFetcher: vi.fn().mockResolvedValue({
            ok: false,
            text: () => Promise.resolve(""),
          }),
        }),
      ).resolves.toEqual({ changed: true, promotedPackages: [] });

      await expect(
        readFile(path.join(tempDir, "pnpm-workspace.yaml"), "utf8"),
      ).resolves.toContain("  # dyad-default-allow-builds-channel=local");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("records ignored builds as tagged denials outside the managed block", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dyad-pnpm-deny-"));
    try {
      await expect(
        recordDeniedPnpmBuilds({
          appPath: tempDir,
          allowBuildsText,
          ignoredBuilds: [
            { packageName: "core-js", packageSpec: "core-js@3.49.0" },
            {
              packageName: "@scope/native",
              packageSpec: "@scope/native@1.2.3",
            },
            { packageName: "sharp", packageSpec: "sharp@0.34.0" },
          ],
        }),
      ).resolves.toEqual({
        deniedBuilds: [
          { packageName: "core-js", packageSpec: "core-js@3.49.0" },
          { packageName: "@scope/native", packageSpec: "@scope/native@1.2.3" },
        ],
      });

      await expect(
        readFile(path.join(tempDir, "pnpm-workspace.yaml"), "utf8"),
      ).resolves.toBe(
        [
          "allowBuilds:",
          '  "@scope/native": false # dyad-auto-denied',
          "  core-js: false # dyad-auto-denied",
          "  # dyad-default-allow-builds begin",
          "  # dyad-default-allow-builds-schema=v1",
          "  # dyad-default-allow-builds-data-version=2026-05-21.1",
          "  # dyad-default-allow-builds-channel=local",
          '  "@swc/core": true',
          "  sharp: true",
          "  # dyad-default-allow-builds end",
          "",
          "packages:",
          "  - .",
          "minimumReleaseAge: 1440",
          "",
        ].join("\n"),
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("promotes tagged denials when the allow-list later includes the package", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dyad-pnpm-promote-"));
    const configPath = path.join(tempDir, "pnpm-workspace.yaml");
    const promotedAllowBuildsText = [
      "# dyad-default-allow-builds-schema=v1",
      "# dyad-default-allow-builds-data-version=2026-05-22.1",
      "# dyad-default-allow-builds-channel=local",
      "core-js",
      "sharp",
      "",
    ].join("\n");

    try {
      await writeFile(
        configPath,
        [
          "allowBuilds:",
          "  core-js: false # dyad-auto-denied",
          "  user-denied: false",
          "  # dyad-default-allow-builds begin",
          "  # dyad-default-allow-builds-schema=v1",
          "  # dyad-default-allow-builds-data-version=2026-05-21.1",
          "  # dyad-default-allow-builds-channel=local",
          "  sharp: true",
          "  # dyad-default-allow-builds end",
          "minimumReleaseAge: 1440",
          "",
        ].join("\n"),
      );

      await expect(
        ensurePnpmAllowBuildsConfigured({
          appPath: tempDir,
          allowBuildsText: promotedAllowBuildsText,
        }),
      ).resolves.toEqual({ changed: true, promotedPackages: ["core-js"] });

      await expect(readFile(configPath, "utf8")).resolves.toBe(
        [
          "allowBuilds:",
          "  user-denied: false",
          "  # dyad-default-allow-builds begin",
          "  # dyad-default-allow-builds-schema=v1",
          "  # dyad-default-allow-builds-data-version=2026-05-22.1",
          "  # dyad-default-allow-builds-channel=local",
          "  core-js: true",
          "  sharp: true",
          "  # dyad-default-allow-builds end",
          "minimumReleaseAge: 1440",
          "",
          "packages:",
          "  - .",
          "",
        ].join("\n"),
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("converts pnpm placeholder entries into tagged denials", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "dyad-pnpm-placeholder-"),
    );
    const configPath = path.join(tempDir, "pnpm-workspace.yaml");
    try {
      // pnpm 11 appends this placeholder after a non-strict install with
      // ignored builds; it does not satisfy strict mode and must not be
      // treated as a user decision.
      await writeFile(
        configPath,
        [
          "allowBuilds:",
          "  core-js: set this to true or false",
          "  # dyad-default-allow-builds begin",
          "  # dyad-default-allow-builds-schema=v1",
          "  # dyad-default-allow-builds-data-version=2026-05-21.1",
          "  # dyad-default-allow-builds-channel=local",
          "  sharp: true",
          "  # dyad-default-allow-builds end",
          "packages:",
          "  - .",
          "minimumReleaseAge: 1440",
          "",
        ].join("\n"),
      );

      await expect(
        recordDeniedPnpmBuilds({
          appPath: tempDir,
          allowBuildsText,
          ignoredBuilds: [
            { packageName: "core-js", packageSpec: "core-js@3.49.0" },
          ],
        }),
      ).resolves.toEqual({
        deniedBuilds: [
          { packageName: "core-js", packageSpec: "core-js@3.49.0" },
        ],
      });

      const nextConfig = await readFile(configPath, "utf8");
      expect(nextConfig).toContain("core-js: false # dyad-auto-denied");
      expect(nextConfig).not.toContain("set this to true or false");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves placeholder entries even without an ignored-builds list", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "dyad-pnpm-placeholder-ensure-"),
    );
    const configPath = path.join(tempDir, "pnpm-workspace.yaml");
    try {
      await writeFile(
        configPath,
        [
          "allowBuilds:",
          "  core-js: set this to true or false",
          "  sharp: set this to true or false",
          "  # dyad-default-allow-builds begin",
          "  # dyad-default-allow-builds-schema=v1",
          "  # dyad-default-allow-builds-data-version=2026-05-21.1",
          "  # dyad-default-allow-builds-channel=local",
          '  "@swc/core": true',
          "  # dyad-default-allow-builds end",
          "packages:",
          "  - .",
          "minimumReleaseAge: 1440",
          "",
        ].join("\n"),
      );

      // App-start ensure pass: sharp is in the allow-list so its placeholder
      // resolves to the managed `true`; core-js becomes a tagged denial.
      await expect(
        ensurePnpmAllowBuildsConfigured({
          appPath: tempDir,
          allowBuildsText,
        }),
      ).resolves.toEqual({ changed: true, promotedPackages: [] });

      const nextConfig = await readFile(configPath, "utf8");
      expect(nextConfig).toContain("core-js: false # dyad-auto-denied");
      expect(nextConfig).toContain("sharp: true");
      expect(nextConfig).not.toContain("set this to true or false");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates the allowBuilds key when recording offline denials into a config without one", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "dyad-pnpm-deny-no-key-"),
    );
    const configPath = path.join(tempDir, "pnpm-workspace.yaml");
    try {
      // Contrived: remote-channel metadata forces the offline denial-only
      // path, but the allowBuilds key itself was stripped by an external
      // tool. Denials must still be recorded, not silently dropped.
      await writeFile(
        configPath,
        [
          "# dyad-default-allow-builds begin",
          "# dyad-default-allow-builds-schema=v1",
          "# dyad-default-allow-builds-data-version=2026-05-21.1",
          "# dyad-default-allow-builds-channel=remote",
          "# dyad-default-allow-builds end",
          "packages:",
          "  - .",
          "",
        ].join("\n"),
      );

      const failingFetcher = vi.fn(async () => ({
        ok: false,
        text: async () => "",
      }));

      await expect(
        recordDeniedPnpmBuilds({
          appPath: tempDir,
          remoteAllowBuildsTextFetcher: failingFetcher,
          ignoredBuilds: [
            { packageName: "core-js", packageSpec: "core-js@3.49.0" },
          ],
        }),
      ).resolves.toEqual({
        deniedBuilds: [
          { packageName: "core-js", packageSpec: "core-js@3.49.0" },
        ],
      });

      const nextConfig = await readFile(configPath, "utf8");
      expect(nextConfig).toContain("allowBuilds:");
      expect(nextConfig).toContain("core-js: false # dyad-auto-denied");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("records denials against existing config when the remote allow-list is unavailable", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "dyad-pnpm-deny-offline-"),
    );
    const configPath = path.join(tempDir, "pnpm-workspace.yaml");
    try {
      const existingConfig = [
        "allowBuilds:",
        "  # dyad-default-allow-builds begin",
        "  # dyad-default-allow-builds-schema=v1",
        "  # dyad-default-allow-builds-data-version=2026-05-21.1",
        "  # dyad-default-allow-builds-channel=remote",
        "  sharp: true",
        "  # dyad-default-allow-builds end",
        "packages:",
        "  - .",
        "minimumReleaseAge: 1440",
        "",
      ].join("\n");
      await writeFile(configPath, existingConfig);

      const failingFetcher = vi.fn(async () => ({
        ok: false,
        text: async () => "",
      }));

      await expect(
        recordDeniedPnpmBuilds({
          appPath: tempDir,
          remoteAllowBuildsTextFetcher: failingFetcher,
          ignoredBuilds: [
            { packageName: "core-js", packageSpec: "core-js@3.49.0" },
            { packageName: "sharp", packageSpec: "sharp@0.34.0" },
          ],
        }),
      ).resolves.toEqual({
        deniedBuilds: [
          { packageName: "core-js", packageSpec: "core-js@3.49.0" },
        ],
      });

      const nextConfig = await readFile(configPath, "utf8");
      expect(nextConfig).toContain("core-js: false # dyad-auto-denied");
      // The remote-managed block must be preserved untouched.
      expect(nextConfig).toContain(
        "# dyad-default-allow-builds-channel=remote",
      );
      expect(nextConfig).toContain("sharp: true");
      expect(nextConfig).not.toContain("sharp: false");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("readPnpmIgnoredBuilds", () => {
  it("parses the JSON .modules.yaml written by pnpm 10.x/11.x", async () => {
    // Captured from a real `pnpm install` with pnpm 11.10.0 — the file is
    // JSON despite the .yaml extension.
    expect(
      parsePnpmIgnoredBuildsFromModulesYaml(
        JSON.stringify(
          {
            hoistedDependencies: {},
            hoistPattern: ["*"],
            included: { dependencies: true, devDependencies: true },
            ignoredBuilds: ["core-js@3.49.0", "@scope/native@1.2.3"],
            layoutVersion: 5,
            pendingBuilds: [],
          },
          null,
          2,
        ),
      ),
    ).toEqual([
      { packageName: "core-js", packageSpec: "core-js@3.49.0" },
      { packageName: "@scope/native", packageSpec: "@scope/native@1.2.3" },
    ]);
  });

  it("returns no ignored builds for JSON .modules.yaml without the key", async () => {
    expect(
      parsePnpmIgnoredBuildsFromModulesYaml(
        JSON.stringify({ layoutVersion: 5, pendingBuilds: [] }),
      ),
    ).toEqual([]);
  });

  it("parses ignored build specs from block-style YAML .modules.yaml", async () => {
    expect(
      parsePnpmIgnoredBuildsFromModulesYaml(
        [
          "layoutVersion: 5",
          "ignoredBuilds:",
          "  - core-js@3.49.0",
          '  - "@scope/native@1.2.3"',
          "pendingBuilds: []",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { packageName: "core-js", packageSpec: "core-js@3.49.0" },
      { packageName: "@scope/native", packageSpec: "@scope/native@1.2.3" },
    ]);
  });

  it("reads ignored builds from the app path", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "dyad-pnpm-ignored-builds-"),
    );
    const modulesYamlContent = `${JSON.stringify(
      { ignoredBuilds: ["core-js@3.49.0"], layoutVersion: 5 },
      null,
      2,
    )}\n`;
    try {
      await mkdir(path.join(tempDir, "node_modules"), { recursive: true });
      await writeFile(
        path.join(tempDir, "node_modules", ".modules.yaml"),
        modulesYamlContent,
      );

      await expect(readPnpmIgnoredBuilds(tempDir)).resolves.toEqual([
        { packageName: "core-js", packageSpec: "core-js@3.49.0" },
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("parsePnpmIgnoredBuildsFromOutput", () => {
  it("parses the strict-mode error line", () => {
    expect(
      parsePnpmIgnoredBuildsFromOutput(
        "[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: core-js@3.49.0, @scope/native@1.2.3\n",
      ),
    ).toEqual([
      { packageName: "core-js", packageSpec: "core-js@3.49.0" },
      { packageName: "@scope/native", packageSpec: "@scope/native@1.2.3" },
    ]);
  });

  it("strips the trailing period and box borders from the warning-box form", () => {
    expect(
      parsePnpmIgnoredBuildsFromOutput(
        "│   Ignored build scripts: core-js@3.49.0.                    │\n",
      ),
    ).toEqual([{ packageName: "core-js", packageSpec: "core-js@3.49.0" }]);
  });
});

describe("getBestEffortPnpmRebuildCommand", () => {
  it("returns null when no packages are promoted", () => {
    expect(getBestEffortPnpmRebuildCommand([])).toBeNull();
  });

  it("emits unquoted names with a cross-shell fallback", () => {
    // Single quotes are literal and `true` is not a command under cmd.exe,
    // so the command must avoid both to be safe on Windows.
    expect(getBestEffortPnpmRebuildCommand(["core-js", "@scope/native"])).toBe(
      "(pnpm rebuild core-js @scope/native || echo pnpm rebuild skipped)",
    );
  });

  it("drops names that are not plain npm package names", () => {
    expect(
      getBestEffortPnpmRebuildCommand(["core-js", "bad name; rm -rf /"]),
    ).toBe("(pnpm rebuild core-js || echo pnpm rebuild skipped)");
    expect(getBestEffortPnpmRebuildCommand(["$(evil)"])).toBeNull();
  });
});

describe("buildAddDependencyCommand", () => {
  it.each<[PackageManager, boolean, { command: string; args: string[] }]>([
    [
      "pnpm",
      true,
      {
        command: "npx",
        args: [
          "--prefer-offline",
          "--yes",
          "sfw@2.0.4",
          "pnpm",
          "--config.pm-on-fail=ignore",
          "--config.confirmModulesPurge=false",
          "--config.strictDepBuilds=false",
          "add",
          "--ignore-workspace-root-check",
          "react",
          "zod",
        ],
      },
    ],
    [
      "npm",
      true,
      {
        command: "npx",
        args: [
          "--prefer-offline",
          "--yes",
          "sfw@2.0.4",
          "npm",
          "install",
          "--legacy-peer-deps",
          "react",
          "zod",
        ],
      },
    ],
    [
      "pnpm",
      false,
      {
        command: "pnpm",
        args: [
          "--config.pm-on-fail=ignore",
          "--config.confirmModulesPurge=false",
          "--config.strictDepBuilds=false",
          "add",
          "--ignore-workspace-root-check",
          "react",
          "zod",
        ],
      },
    ],
    [
      "npm",
      false,
      {
        command: "npm",
        args: ["install", "--legacy-peer-deps", "react", "zod"],
      },
    ],
  ])(
    "builds the right command for %s with sfw=%s",
    (manager, useSfw, expected) => {
      expect(
        buildAddDependencyCommand(["react", "zod"], manager, useSfw),
      ).toEqual(expected);
    },
  );

  it.each<[PackageManager, boolean, { command: string; args: string[] }]>([
    [
      "pnpm",
      false,
      {
        command: "pnpm",
        args: [
          "--config.pm-on-fail=ignore",
          "--config.confirmModulesPurge=false",
          "--config.strictDepBuilds=false",
          "add",
          "--ignore-workspace-root-check",
          "-D",
          "nitro",
        ],
      },
    ],
    [
      "npm",
      false,
      {
        command: "npm",
        args: ["install", "--legacy-peer-deps", "--save-dev", "nitro"],
      },
    ],
    [
      "pnpm",
      true,
      {
        command: "npx",
        args: [
          "--prefer-offline",
          "--yes",
          "sfw@2.0.4",
          "pnpm",
          "--config.pm-on-fail=ignore",
          "--config.confirmModulesPurge=false",
          "--config.strictDepBuilds=false",
          "add",
          "--ignore-workspace-root-check",
          "-D",
          "nitro",
        ],
      },
    ],
  ])(
    "installs as a devDependency for %s with sfw=%s when dev:true",
    (manager, useSfw, expected) => {
      expect(
        buildAddDependencyCommand(["nitro"], manager, useSfw, { dev: true }),
      ).toEqual(expected);
    },
  );
});

describe("ensureSocketFirewallInstalled", () => {
  it("returns available when sfw is already installed", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValue({ stdout: "", stderr: "" });

    await expect(ensureSocketFirewallInstalled(runner)).resolves.toEqual({
      available: true,
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      "npx",
      ["--prefer-offline", "--yes", "sfw@2.0.4", "--help"],
      {
        env: expect.objectContaining({
          COREPACK_ENABLE_PROJECT_SPEC: "0",
          COREPACK_ENABLE_STRICT: "0",
          npm_config_package_manager_strict: "false",
          npm_config_pm_on_fail: "ignore",
        }),
        timeoutMs: SOCKET_FIREWALL_PROBE_TIMEOUT_MS,
      },
    );
  });

  it("returns a warning when sfw cannot be run through npx", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockRejectedValueOnce(new Error("npx sfw failed"));

    await expect(ensureSocketFirewallInstalled(runner)).resolves.toEqual({
      available: false,
      warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      "npx",
      ["--prefer-offline", "--yes", "sfw@2.0.4", "--help"],
      {
        env: expect.objectContaining({
          COREPACK_ENABLE_PROJECT_SPEC: "0",
          COREPACK_ENABLE_STRICT: "0",
          npm_config_package_manager_strict: "false",
          npm_config_pm_on_fail: "ignore",
        }),
        timeoutMs: SOCKET_FIREWALL_PROBE_TIMEOUT_MS,
      },
    );
  });
});

describe("resolveExecutableName", () => {
  it("uses Windows cmd shims for package-manager commands", () => {
    expect(resolveExecutableName("npx", "win32")).toBe("npx.cmd");
    expect(resolveExecutableName("pnpm", "win32")).toBe("pnpm.cmd");
  });

  it("preserves explicit executables and Unix command names", () => {
    expect(resolveExecutableName("node.exe", "win32")).toBe("node.exe");
    expect(resolveExecutableName("npx", "darwin")).toBe("npx");
  });
});

describe("buildPtyInvocation", () => {
  it("wraps Windows .cmd shims through cmd.exe for PTY execution", () => {
    expect(
      buildPtyInvocation("npx", ["--yes", "sfw@2.0.4"], "win32", "cmd.exe"),
    ).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npx.cmd --yes sfw@2.0.4"],
    });
  });

  it("quotes Windows arguments containing spaces and embedded quotes", () => {
    expect(
      buildPtyInvocation(
        "npx",
        ["--message", 'value with spaces and "quotes"'],
        "win32",
        "cmd.exe",
      ),
    ).toEqual({
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        'npx.cmd --message "value with spaces and ""quotes"""',
      ],
    });
  });

  it("quotes Windows arguments containing cmd metacharacters without mutating them", () => {
    expect(
      buildPtyInvocation(
        "npx",
        ["--filter", "name&echo^(injected)"],
        "win32",
        "cmd.exe",
      ),
    ).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", 'npx.cmd --filter "name&echo^(injected)"'],
    });
  });

  it("quotes empty Windows arguments so their position is preserved", () => {
    expect(
      buildPtyInvocation("npx", ["--flag", ""], "win32", "cmd.exe"),
    ).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", 'npx.cmd --flag ""'],
    });
  });

  it("passes Unix commands directly to the PTY", () => {
    expect(buildPtyInvocation("pnpm", ["add", "react"], "darwin")).toEqual({
      command: "pnpm",
      args: ["add", "react"],
    });
  });
});

describe("runCommand", () => {
  it("preserves the original command in Windows-facing PTY errors", async () => {
    await withPlatform("win32", async () => {
      runPtyCommandMock.mockRejectedValueOnce(
        new PtyCommandExecutionError({
          message: "Command 'npx --yes sfw@2.0.4' exited with code 1",
          output: "npm ERR! ERESOLVE unable to resolve dependency tree",
          exitCode: 1,
        }),
      );

      await expect(
        runCommand("npx", ["--yes", "sfw@2.0.4"]),
      ).rejects.toMatchObject({
        message: "Command 'npx --yes sfw@2.0.4' exited with code 1",
        stdout: "npm ERR! ERESOLVE unable to resolve dependency tree",
        exitCode: 1,
      });

      expect(runPtyCommandMock).toHaveBeenCalledWith(
        expect.stringMatching(/cmd\.exe$/i),
        ["/d", "/s", "/c", "npx.cmd --yes sfw@2.0.4"],
        expect.objectContaining({
          displayCommand: "npx --yes sfw@2.0.4",
        }),
      );
    });
  });
});
