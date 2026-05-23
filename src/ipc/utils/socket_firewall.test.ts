import { beforeEach, describe, expect, it, vi } from "vitest";
import { PtyCommandExecutionError } from "@/ipc/utils/pty_command_runner";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  getPnpmMinimumReleaseAgeSupport,
  PACKAGE_MANAGER_PROBE_TIMEOUT_MS,
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

describe("detectPreferredPackageManager", () => {
  it("prefers pnpm when available", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValue({ stdout: "10.16.0", stderr: "" });

    await expect(detectPreferredPackageManager(runner)).resolves.toBe("pnpm");
    expect(runner).toHaveBeenCalledWith("pnpm", ["--version"], {
      timeoutMs: PACKAGE_MANAGER_PROBE_TIMEOUT_MS,
    });
  });

  it("falls back to npm when pnpm is unavailable", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockRejectedValue(new Error("ENOENT"));

    await expect(detectPreferredPackageManager(runner)).resolves.toBe("npm");
    expect(runner).toHaveBeenCalledWith("pnpm", ["--version"], {
      timeoutMs: PACKAGE_MANAGER_PROBE_TIMEOUT_MS,
    });
  });

  it("prefers pnpm when pnpm is available but too old for minimumReleaseAge", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValue({ stdout: "10.15.0", stderr: "" });

    await expect(detectPreferredPackageManager(runner)).resolves.toBe("pnpm");
    expect(runner).toHaveBeenCalledWith("pnpm", ["--version"], {
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
      ).resolves.toEqual({ changed: true });

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
      ).resolves.toEqual({ changed: true });

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
      ).resolves.toEqual({ changed: true });
      await expect(
        ensurePnpmAllowBuildsConfigured({
          appPath: secondTempDir,
          remoteAllowBuildsTextFetcher,
        }),
      ).resolves.toEqual({ changed: true });

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
      ).resolves.toEqual({ changed: true });

      dateNowSpy.mockReturnValue(startMs + DYAD_ALLOW_BUILDS_CACHE_TTL_MS + 1);

      await expect(
        ensurePnpmAllowBuildsConfigured({
          appPath: secondTempDir,
          remoteAllowBuildsTextFetcher,
        }),
      ).resolves.toEqual({ changed: true });

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
      ).resolves.toEqual({ changed: false });

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
      ).resolves.toEqual({ changed: true });

      await expect(
        readFile(path.join(tempDir, "pnpm-workspace.yaml"), "utf8"),
      ).resolves.toContain("  # dyad-default-allow-builds-channel=local");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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
          "--config.confirmModulesPurge=false",
          "--config.strictDepBuilds=false",
          "add",
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
          "--config.confirmModulesPurge=false",
          "--config.strictDepBuilds=false",
          "add",
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
          "--config.confirmModulesPurge=false",
          "--config.strictDepBuilds=false",
          "add",
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
          "--config.confirmModulesPurge=false",
          "--config.strictDepBuilds=false",
          "add",
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
        "cmd.exe",
        ["/d", "/s", "/c", "npx.cmd --yes sfw@2.0.4"],
        expect.objectContaining({
          displayCommand: "npx --yes sfw@2.0.4",
        }),
      );
    });
  });
});
