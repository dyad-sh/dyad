import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADD_DEPENDENCY_INSTALL_TIMEOUT_MS,
  CommandExecutionError,
  SOCKET_FIREWALL_WARNING_MESSAGE,
} from "@/ipc/utils/socket_firewall";
import {
  executeAddDependency,
  ExecuteAddDependencyError,
} from "./executeAddDependency";

const {
  detectPreferredPackageManagerMock,
  ensureSocketFirewallInstalledMock,
  runCommandMock,
  readEffectiveSettingsMock,
  dbUpdateSetMock,
  dbUpdateWhereMock,
} = vi.hoisted(() => ({
  detectPreferredPackageManagerMock: vi.fn(),
  ensureSocketFirewallInstalledMock: vi.fn(),
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
    detectPreferredPackageManager: detectPreferredPackageManagerMock,
    ensureSocketFirewallInstalled: ensureSocketFirewallInstalledMock,
    runCommand: runCommandMock,
  };
});

describe("executeAddDependency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbUpdateSetMock.mockReturnValue({
      where: dbUpdateWhereMock,
    });
    dbUpdateWhereMock.mockResolvedValue(undefined);
    detectPreferredPackageManagerMock.mockResolvedValue("pnpm");
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

  it("uses npm directly when pnpm is unavailable", async () => {
    detectPreferredPackageManagerMock.mockResolvedValue("npm");
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
        timeoutMs: ADD_DEPENDENCY_INSTALL_TIMEOUT_MS,
      },
    );
    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      installResults: "installed via npm",
      warningMessages: [SOCKET_FIREWALL_WARNING_MESSAGE],
    });
  });

  it("rejects invalid npm package specs before invoking the shell", async () => {
    await expect(
      executeAddDependency({
        packages: ["react@^18.0.0"],
        message: {
          id: 1,
          content:
            '<dyad-add-dependency packages="react@^18.0.0"></dyad-add-dependency>',
        } as any,
        appPath: "/tmp/app",
      }),
    ).rejects.toMatchObject({
      displaySummary: "Invalid npm package name: react@^18.0.0",
      warningMessages: [],
    });

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
});
