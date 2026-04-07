import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandExecutionError,
  SOCKET_FIREWALL_FALLBACK_WARNING_MESSAGE,
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
  readSettingsMock,
  dbUpdateSetMock,
  dbUpdateWhereMock,
} = vi.hoisted(() => ({
  detectPreferredPackageManagerMock: vi.fn(),
  ensureSocketFirewallInstalledMock: vi.fn(),
  runCommandMock: vi.fn(),
  readSettingsMock: vi.fn(),
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
  readSettings: readSettingsMock,
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
    readSettingsMock.mockReturnValue({
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

  it("includes socket stderr verdict details when sfw blocks a dependency", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: true,
    });
    runCommandMock.mockRejectedValueOnce(
      new CommandExecutionError({
        message: "pnpm blocked",
        stderr: "Socket Firewall blocked react\nPolicy: malware",
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

  it("does not fall back to a direct install when the real sfw cli blocks a dependency", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: true,
    });
    runCommandMock.mockRejectedValueOnce(
      new CommandExecutionError({
        message: "pnpm blocked",
        stderr:
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

  it("falls back to direct package-manager commands after sfw runtime failures", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: true,
    });
    runCommandMock
      .mockRejectedValueOnce(
        new CommandExecutionError({
          message: "sfw pnpm failed",
          stderr: "Socket Firewall timed out",
          exitCode: 1,
        }),
      )
      .mockResolvedValueOnce({ stdout: "installed via pnpm", stderr: "" });

    const result = await executeAddDependency({
      packages: ["react"],
      message: {
        id: 1,
        content: '<dyad-add-dependency packages="react"></dyad-add-dependency>',
      } as any,
      appPath: "/tmp/app",
    });

    expect(runCommandMock).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      ["add", "react"],
      { cwd: "/tmp/app" },
    );
    expect(runCommandMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      installResults: "installed via pnpm",
      warningMessages: [SOCKET_FIREWALL_FALLBACK_WARNING_MESSAGE],
    });
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
      { cwd: "/tmp/app" },
    );
    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      installResults: "installed via npm",
      warningMessages: [SOCKET_FIREWALL_WARNING_MESSAGE],
    });
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
      packages: ['react"&<safe>'],
      message: {
        id: 1,
        content:
          '<dyad-add-dependency packages="react&quot;&amp;&lt;safe&gt;"></dyad-add-dependency>',
      } as any,
      appPath: "/tmp/app",
    });

    expect(dbUpdateSetMock).toHaveBeenCalledWith({
      content:
        '<dyad-add-dependency packages="react&quot;&amp;&lt;safe&gt;">installed &lt;react&gt;</dyad-add-dependency>',
    });
  });
});
