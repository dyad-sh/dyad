import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandExecutionError,
  SOCKET_FIREWALL_WARNING_MESSAGE,
} from "@/ipc/utils/socket_firewall";
import {
  executeAddDependency,
  ExecuteAddDependencyError,
} from "./executeAddDependency";

const { ensureSocketFirewallInstalledMock, runCommandMock, readSettingsMock } =
  vi.hoisted(() => ({
    ensureSocketFirewallInstalledMock: vi.fn(),
    runCommandMock: vi.fn(),
    readSettingsMock: vi.fn(),
  }));

vi.mock("../../db", () => ({
  db: {
    update: vi.fn(),
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
    ensureSocketFirewallInstalled: ensureSocketFirewallInstalledMock,
    runCommand: runCommandMock,
  };
});

describe("executeAddDependency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSettingsMock.mockReturnValue({
      blockUnsafeNpmPackages: true,
    });
  });

  it("preserves the firewall warning when package installation later fails", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: false,
      warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
    });
    runCommandMock
      .mockRejectedValueOnce(new Error("pnpm failed"))
      .mockRejectedValueOnce(new Error("npm failed"));

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
      message: "npm failed",
    });
  });

  it("includes socket stderr verdict details when sfw blocks a dependency", async () => {
    ensureSocketFirewallInstalledMock.mockResolvedValue({
      available: true,
    });
    runCommandMock
      .mockRejectedValueOnce(
        new CommandExecutionError({
          message: "pnpm blocked",
          stderr: "Socket Firewall blocked react\nPolicy: malware",
          exitCode: 1,
        }),
      )
      .mockRejectedValueOnce(
        new CommandExecutionError({
          message: "npm blocked",
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
});
