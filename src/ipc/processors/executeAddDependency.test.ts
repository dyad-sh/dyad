import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADD_DEPENDENCY_INSTALL_TIMEOUT_MS,
  CommandExecutionError,
  PNPM_INSTALL_POLICY_ARGS,
  SOCKET_FIREWALL_WARNING_MESSAGE,
} from "@/ipc/utils/socket_firewall";
import {
  executeAddDependency,
  ExecuteAddDependencyError,
} from "./executeAddDependency";

const {
  commitPnpmAllowBuildsConfigIfChangedMock,
  ensureSocketFirewallInstalledMock,
  getPnpmMinimumReleaseAgeSupportMock,
  resolvePnpmIgnoredBuildsMock,
  recordAndReportDeniedPnpmBuildsMock,
  runCommandMock,
  readEffectiveSettingsMock,
  dbUpdateSetMock,
  dbUpdateWhereMock,
} = vi.hoisted(() => ({
  commitPnpmAllowBuildsConfigIfChangedMock: vi.fn(),
  ensureSocketFirewallInstalledMock: vi.fn(),
  getPnpmMinimumReleaseAgeSupportMock: vi.fn(),
  resolvePnpmIgnoredBuildsMock: vi.fn(),
  recordAndReportDeniedPnpmBuildsMock: vi.fn(),
  runCommandMock: vi.fn(),
  readEffectiveSettingsMock: vi.fn(),
  dbUpdateSetMock: vi.fn(),
  dbUpdateWhereMock: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: {
    update: vi.fn(() => ({
      set: dbUpdateSetMock,
    })),
  },
}));

vi.mock("../../db/schema", () => ({
  messages: {},
}));

vi.mock("@/main/settings", () => ({
  readEffectiveSettings: readEffectiveSettingsMock,
}));

vi.mock("@/ipc/utils/socket_firewall", async () => {
  const actual = await vi.importActual<
    typeof import("@/ipc/utils/socket_firewall")
  >("@/ipc/utils/socket_firewall");

  return {
    ...actual,
    commitPnpmAllowBuildsConfigIfChanged:
      commitPnpmAllowBuildsConfigIfChangedMock,
    ensureSocketFirewallInstalled: ensureSocketFirewallInstalledMock,
    getPnpmMinimumReleaseAgeSupport: getPnpmMinimumReleaseAgeSupportMock,
    runCommand: runCommandMock,
  };
});

vi.mock("@/ipc/utils/pnpm_denied_builds", () => ({
  resolvePnpmIgnoredBuilds: resolvePnpmIgnoredBuildsMock,
  recordAndReportDeniedPnpmBuilds: recordAndReportDeniedPnpmBuildsMock,
}));

describe("executeAddDependency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbUpdateSetMock.mockReturnValue({
      where: dbUpdateWhereMock,
    });
    dbUpdateWhereMock.mockResolvedValue(undefined);
    getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
      available: true,
      minimumReleaseAgeSupported: true,
      version: "10.16.0",
    });
    commitPnpmAllowBuildsConfigIfChangedMock.mockResolvedValue({
      promotedPackages: [],
    });
    resolvePnpmIgnoredBuildsMock.mockResolvedValue([]);
    recordAndReportDeniedPnpmBuildsMock.mockResolvedValue({
      deniedBuilds: [],
    });
    readEffectiveSettingsMock.mockResolvedValue({
      blockUnsafeNpmPackages: true,
    });
  });

  it("preserves the firewall warning when package installation later fails", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: false,
      warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
    });
    runCommandMock.mockRejectedValueOnce(new Error("pnpm failed"));

    let caughtError: unknown;
    try {
      await executeAddDependency({
        packages: ["react"],
        message: {
          id: 1,
          content:
            '<dyad-add-dependency packages="react"></dyad-add-dependency>',
        } as any,
        appPath: "/tmp/app",
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(ExecuteAddDependencyError);
    expect(caughtError).toMatchObject({
      warningMessages: [SOCKET_FIREWALL_WARNING_MESSAGE],
      message: "pnpm failed",
    });
    expect(commitPnpmAllowBuildsConfigIfChangedMock).toHaveBeenCalledWith(
      "/tmp/app",
    );
  });

  it("uses the most relevant combined PTY output line as the display summary", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: true,
    });
    runCommandMock.mockRejectedValueOnce(
      new CommandExecutionError({
        message: "pnpm blocked",
        stdout:
          "Progress: resolved 12, reused 0, downloaded 0, added 0\nSocket Firewall blocked react\nPolicy: malware",
        exitCode: 1,
      }),
    );

    let caughtError: unknown;
    try {
      await executeAddDependency({
        packages: ["react"],
        message: {
          id: 1,
          content:
            '<dyad-add-dependency packages="react"></dyad-add-dependency>',
        } as any,
        appPath: "/tmp/app",
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(ExecuteAddDependencyError);
    expect(caughtError).toMatchObject({
      displaySummary: "Socket Firewall blocked react",
      displayDetails: "Socket Firewall blocked react\nPolicy: malware",
      warningMessages: [],
    });
  });

  it("filters PTY progress noise out of expanded display details", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: false,
      warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
    });
    runCommandMock.mockRejectedValueOnce(
      new CommandExecutionError({
        message: "npm install failed",
        stdout: [
          "Progress: resolved 1, reused 0, downloaded 0, added 0",
          "npm warn deprecated left-pad@1.3.0: use String.prototype.padStart()",
          "npm ERR! code ERESOLVE",
          "npm ERR! ERESOLVE unable to resolve dependency tree",
          "npm ERR! A complete log of this run can be found in:",
          "npm ERR!     /Users/me/.npm/_logs/2026-04-08-debug-0.log",
        ].join("\n"),
        exitCode: 1,
      }),
    );

    await expect(
      executeAddDependency({
        packages: ["react"],
        message: {
          id: 1,
          content:
            '<dyad-add-dependency packages="react"></dyad-add-dependency>',
        } as any,
        appPath: "/tmp/app",
      }),
    ).rejects.toMatchObject({
      displayDetails:
        "npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree",
      displaySummary: "npm ERR! ERESOLVE unable to resolve dependency tree",
      warningMessages: [SOCKET_FIREWALL_WARNING_MESSAGE],
    });
  });

  it("falls back to the error message when PTY output only contains progress noise", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: true,
    });
    runCommandMock.mockRejectedValueOnce(
      new CommandExecutionError({
        message: "Command 'pnpm add react' was terminated by signal 15",
        stdout: [
          "Progress: resolved 50, reused 0, downloaded 0, added 0",
          "Packages: +1",
        ].join("\n"),
        exitCode: 0,
      }),
    );

    await expect(
      executeAddDependency({
        packages: ["react"],
        message: {
          id: 1,
          content:
            '<dyad-add-dependency packages="react"></dyad-add-dependency>',
        } as any,
        appPath: "/tmp/app",
      }),
    ).rejects.toMatchObject({
      displayDetails: "Command 'pnpm add react' was terminated by signal 15",
      displaySummary: "Command 'pnpm add react' was terminated by signal 15",
      warningMessages: [],
    });
  });

  it("ignores npm log-noise lines and keeps the actionable npm ERR summary", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: false,
      warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
    });
    runCommandMock.mockRejectedValueOnce(
      new CommandExecutionError({
        message: "npm install failed",
        stdout: [
          "npm ERR! code ERESOLVE",
          "npm ERR! ERESOLVE unable to resolve dependency tree",
          "npm ERR! A complete log of this run can be found in:",
          "npm ERR!     /Users/me/.npm/_logs/2026-04-08-debug-0.log",
        ].join("\n"),
        exitCode: 1,
      }),
    );

    await expect(
      executeAddDependency({
        packages: ["react"],
        message: {
          id: 1,
          content:
            '<dyad-add-dependency packages="react"></dyad-add-dependency>',
        } as any,
        appPath: "/tmp/app",
      }),
    ).rejects.toMatchObject({
      displaySummary: "npm ERR! ERESOLVE unable to resolve dependency tree",
      warningMessages: [SOCKET_FIREWALL_WARNING_MESSAGE],
    });
  });

  it("keeps ERR_PNPM summaries instead of falling back to progress output", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: false,
      warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
    });
    runCommandMock.mockRejectedValueOnce(
      new CommandExecutionError({
        message: "pnpm add failed",
        stdout: [
          "Progress: resolved 1, reused 0, downloaded 0, added 0",
          "ERR_PNPM_FETCH_404 GET https://registry.npmjs.org/react: Not Found",
        ].join("\n"),
        exitCode: 1,
      }),
    );

    await expect(
      executeAddDependency({
        packages: ["react"],
        message: {
          id: 1,
          content:
            '<dyad-add-dependency packages="react"></dyad-add-dependency>',
        } as any,
        appPath: "/tmp/app",
      }),
    ).rejects.toMatchObject({
      displaySummary:
        "ERR_PNPM_FETCH_404 GET https://registry.npmjs.org/react: Not Found",
      warningMessages: [SOCKET_FIREWALL_WARNING_MESSAGE],
    });
  });

  it("does not fall back to a direct install when the real sfw cli blocks a dependency", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: true,
    });
    runCommandMock.mockRejectedValueOnce(
      new CommandExecutionError({
        message: "pnpm blocked",
        stdout:
          " - blocked npm package: name: axois; version: 0.0.1-security; reason: malware (critical)",
        exitCode: 1,
      }),
    );

    await expect(
      executeAddDependency({
        packages: ["axois"],
        message: {
          id: 1,
          content:
            '<dyad-add-dependency packages="axois"></dyad-add-dependency>',
        } as any,
        appPath: "/tmp/app",
      }),
    ).rejects.toMatchObject({
      displaySummary:
        "- blocked npm package: name: axois; version: 0.0.1-security; reason: malware (critical)",
      warningMessages: [],
    });

    expect(runCommandMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed after sfw runtime failures", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: true,
    });
    runCommandMock.mockRejectedValueOnce(
      new CommandExecutionError({
        message: "sfw pnpm failed",
        stdout: "Socket Firewall timed out",
        exitCode: 1,
      }),
    );

    await expect(
      executeAddDependency({
        packages: ["react"],
        message: {
          id: 1,
          content:
            '<dyad-add-dependency packages="react"></dyad-add-dependency>',
        } as any,
        appPath: "/tmp/app",
      }),
    ).rejects.toMatchObject({
      displaySummary: "Socket Firewall timed out",
      warningMessages: [],
    });
    expect(runCommandMock).toHaveBeenCalledTimes(1);
  });

  it("uses pnpm with policy flags when pnpm cannot enforce the release-age policy", async () => {
    readEffectiveSettingsMock.mockResolvedValueOnce({
      blockUnsafeNpmPackages: true,
      enablePnpmMinimumReleaseAgeWarning: true,
    });
    getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
      available: true,
      minimumReleaseAgeSupported: false,
      warningMessage:
        "Install pnpm 10.16.0 or newer for the strongest protection",
    });
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: false,
      warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
    });
    runCommandMock.mockResolvedValueOnce({
      stdout: "installed via pnpm",
      stderr: "",
    });

    const result = await executeAddDependency({
      packages: ["react"],
      message: {
        id: 1,
        content: '<dyad-add-dependency packages="react"></dyad-add-dependency>',
      } as any,
      appPath: "/tmp/app",
    });

    expect(runCommandMock).toHaveBeenCalledWith(
      "pnpm",
      [
        ...PNPM_INSTALL_POLICY_ARGS,
        "add",
        "--ignore-workspace-root-check",
        "react",
      ],
      {
        cwd: "/tmp/app",
        env: expect.objectContaining({
          COREPACK_ENABLE_PROJECT_SPEC: "0",
          COREPACK_ENABLE_STRICT: "0",
          npm_config_package_manager_strict: "false",
          npm_config_pm_on_fail: "ignore",
        }),
        timeoutMs: ADD_DEPENDENCY_INSTALL_TIMEOUT_MS,
      },
    );
    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(commitPnpmAllowBuildsConfigIfChangedMock).toHaveBeenCalledWith(
      "/tmp/app",
    );
    expect(result).toMatchObject({
      installResults: "installed via pnpm",
      warningMessages: [
        SOCKET_FIREWALL_WARNING_MESSAGE,
        "Install pnpm 10.16.0 or newer for the strongest protection",
      ],
    });
  });

  it("falls back to npm when pnpm is unavailable", async () => {
    getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
      available: false,
      minimumReleaseAgeSupported: false,
      warningMessage:
        "Install pnpm 10.16.0 or newer for the strongest protection",
    });
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: false,
      warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
    });
    runCommandMock.mockResolvedValueOnce({
      stdout: "installed via npm",
      stderr: "",
    });

    const result = await executeAddDependency({
      packages: ["react"],
      message: {
        id: 1,
        content: '<dyad-add-dependency packages="react"></dyad-add-dependency>',
      } as any,
      appPath: "/tmp/app",
    });

    expect(runCommandMock).toHaveBeenCalledWith(
      "npm",
      ["install", "--legacy-peer-deps", "react"],
      {
        cwd: "/tmp/app",
        env: expect.objectContaining({
          COREPACK_ENABLE_PROJECT_SPEC: "0",
          COREPACK_ENABLE_STRICT: "0",
          npm_config_package_manager_strict: "false",
          npm_config_pm_on_fail: "ignore",
        }),
        timeoutMs: ADD_DEPENDENCY_INSTALL_TIMEOUT_MS,
      },
    );
    expect(commitPnpmAllowBuildsConfigIfChangedMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      installResults: "installed via npm",
      warningMessages: [SOCKET_FIREWALL_WARNING_MESSAGE],
    });
  });

  it("uses npm for npm-shaped apps even when pnpm is available", async () => {
    const appPath = await mkdtemp(path.join(os.tmpdir(), "dyad-add-dep-"));
    try {
      await writeFile(path.join(appPath, "package-lock.json"), "{}");
      ensureSocketFirewallInstalledMock.mockResolvedValue({
        available: false,
        warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
      });
      runCommandMock.mockResolvedValueOnce({
        stdout: "installed via npm",
        stderr: "",
      });

      const result = await executeAddDependency({
        packages: ["react"],
        message: {
          id: 1,
          content:
            '<dyad-add-dependency packages="react"></dyad-add-dependency>',
        } as any,
        appPath,
      });

      expect(runCommandMock).toHaveBeenCalledWith(
        "npm",
        ["install", "--legacy-peer-deps", "react"],
        expect.objectContaining({ cwd: appPath }),
      );
      expect(commitPnpmAllowBuildsConfigIfChangedMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        installResults: "installed via npm",
      });
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("does not warn about old pnpm for apps that explicitly use npm", async () => {
    const appPath = await mkdtemp(path.join(os.tmpdir(), "dyad-add-dep-"));
    try {
      await writeFile(
        path.join(appPath, "package.json"),
        JSON.stringify({ packageManager: "npm@10.8.2" }),
      );
      readEffectiveSettingsMock.mockResolvedValueOnce({
        blockUnsafeNpmPackages: true,
        enablePnpmMinimumReleaseAgeWarning: true,
      });
      getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
        available: true,
        minimumReleaseAgeSupported: false,
        warningMessage:
          "Install pnpm 10.16.0 or newer for the strongest protection",
      });
      ensureSocketFirewallInstalledMock.mockResolvedValue({
        available: true,
      });
      runCommandMock.mockResolvedValueOnce({
        stdout: "installed via npm",
        stderr: "",
      });

      const result = await executeAddDependency({
        packages: ["react"],
        message: {
          id: 1,
          content:
            '<dyad-add-dependency packages="react"></dyad-add-dependency>',
        } as any,
        appPath,
      });

      expect(result).toMatchObject({
        installResults: "installed via npm",
        warningMessages: [],
      });
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("installs new packages, saves exact pins, and refreshes existing constraints in separate groups", async () => {
    const appPath = await mkdtemp(path.join(os.tmpdir(), "dyad-add-dep-"));
    try {
      await writeFile(
        path.join(appPath, "package.json"),
        JSON.stringify({
          packageManager: "npm@10.8.2",
          dependencies: { react: "^18.0.0" },
          devDependencies: { typescript: "~5.7.0" },
          optionalDependencies: { sharp: "^0.33.0" },
          peerDependencies: { vite: "^6.0.0" },
        }),
      );
      await writeFile(path.join(appPath, "package-lock.json"), "{}");
      ensureSocketFirewallInstalledMock.mockResolvedValue({
        available: false,
      });
      runCommandMock
        .mockResolvedValueOnce({ stdout: "installed ranges", stderr: "" })
        .mockResolvedValueOnce({ stdout: "installed exact", stderr: "" })
        .mockResolvedValueOnce({ stdout: "updated existing", stderr: "" });

      const packages = [
        "vite",
        "@tanstack/react-query@^5.0.0",
        "zod@4.0.0",
        "react",
        "typescript",
        "sharp",
      ];
      const result = await executeAddDependency({
        packages,
        message: {
          id: 1,
          content: `<dyad-add-dependency packages="${packages.join(" ")}"></dyad-add-dependency>`,
        } as any,
        appPath,
      });

      expect(runCommandMock).toHaveBeenNthCalledWith(
        1,
        "npm",
        [
          "install",
          "--legacy-peer-deps",
          "vite",
          "@tanstack/react-query@^5.0.0",
        ],
        expect.objectContaining({ cwd: appPath }),
      );
      expect(runCommandMock).toHaveBeenNthCalledWith(
        2,
        "npm",
        ["install", "--legacy-peer-deps", "--save-exact", "zod@4.0.0"],
        expect.objectContaining({ cwd: appPath }),
      );
      expect(runCommandMock).toHaveBeenNthCalledWith(
        3,
        "npm",
        ["update", "--legacy-peer-deps", "react", "typescript", "sharp"],
        expect.objectContaining({ cwd: appPath }),
      );
      expect(result.installResults).toBe(
        "installed ranges\ninstalled exact\nupdated existing",
      );
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it.each([
    "react@latest",
    "react@next",
    "react@19",
    "react@19.1",
    "react@19.x",
    "react@^19.0.0",
    "react@~19.1",
    "react@19.0.0-rc.1",
    "@scope/pkg@^2.0.0",
  ])("accepts registry package spec %s", async (packageSpec) => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: false,
    });
    runCommandMock.mockResolvedValueOnce({ stdout: "installed", stderr: "" });

    await executeAddDependency({
      packages: [packageSpec],
      message: {
        id: 1,
        content: `<dyad-add-dependency packages="${packageSpec}"></dyad-add-dependency>`,
      } as any,
      appPath: "/tmp/app",
    });

    expect(runCommandMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["empty input", []],
    ["empty package", [""]],
    ["option", ["--force"]],
    ["current directory", ["."]],
    ["underscore-prefixed name", ["_private"]],
    ["compound range", ["react@>=18 <20"]],
    ["range union", ["react@^18||^19"]],
    ["alias", ["foo@npm:bar@1"]],
    ["workspace", ["foo@workspace:*"]],
    ["local path", ["../foo"]],
    ["URL", ["https://example.com/foo.tgz"]],
    ["GitHub shorthand", ["owner/repo"]],
    ["duplicate package", ["react", "react@latest"]],
  ])("rejects %s before invoking the shell", async (_label, packages) => {
    await expect(
      executeAddDependency({
        packages,
        message: {
          id: 1,
          content: `<dyad-add-dependency packages="${packages.join(" ")}"></dyad-add-dependency>`,
        } as any,
        appPath: "/tmp/app",
      }),
    ).rejects.toBeInstanceOf(ExecuteAddDependencyError);

    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it("escapes package attributes and install output before storing the tag", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: false,
      warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
    });
    runCommandMock.mockResolvedValueOnce({
      stdout: "installed <react>",
      stderr: "",
    });

    await executeAddDependency({
      packages: ["react-safe"],
      message: {
        id: 1,
        content:
          '<dyad-add-dependency packages="react-safe"></dyad-add-dependency>',
      } as any,
      appPath: "/tmp/app",
    });

    expect(dbUpdateSetMock).toHaveBeenCalledWith({
      content:
        '<dyad-add-dependency packages="react-safe">installed &lt;react&gt;</dyad-add-dependency>',
    });
  });

  it("records denied pnpm builds and surfaces the security-policy note", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: false,
    });
    runCommandMock.mockResolvedValueOnce({
      stdout: "installed via pnpm",
      stderr: "",
    });
    resolvePnpmIgnoredBuildsMock.mockResolvedValue([
      { packageName: "core-js", packageSpec: "core-js@3.49.0" },
    ]);
    recordAndReportDeniedPnpmBuildsMock.mockResolvedValue({
      deniedBuilds: [{ packageName: "core-js", packageSpec: "core-js@3.49.0" }],
    });

    const result = await executeAddDependency({
      packages: ["core-js"],
      message: {
        id: 1,
        content:
          '<dyad-add-dependency packages="core-js"></dyad-add-dependency>',
      } as any,
      appPath: "/tmp/app",
    });

    expect(result.installResults).toContain("installed via pnpm");
    expect(result.installResults).toContain(
      "Note: build scripts for core-js were not run (Dyad security policy).",
    );
    expect(recordAndReportDeniedPnpmBuildsMock).toHaveBeenCalledWith({
      appPath: "/tmp/app",
      ignoredBuilds: [
        { packageName: "core-js", packageSpec: "core-js@3.49.0" },
      ],
      source: "add-dependency",
    });
    expect(dbUpdateSetMock).toHaveBeenCalledWith({
      content: expect.stringContaining(
        "Note: build scripts for core-js were not run",
      ),
    });
  });
});
