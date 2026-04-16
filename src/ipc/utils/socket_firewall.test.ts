import { beforeEach, describe, expect, it, vi } from "vitest";
import { PtyCommandExecutionError } from "@/ipc/utils/pty_command_runner";

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
  ensureSocketFirewallInstalled,
  PACKAGE_MANAGER_PROBE_TIMEOUT_MS,
  resolveExecutableName,
  runCommand,
  SOCKET_FIREWALL_PROBE_TIMEOUT_MS,
  SOCKET_FIREWALL_WARNING_MESSAGE,
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
      .mockResolvedValue({ stdout: "10.0.0", stderr: "" });

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
    ["pnpm", false, { command: "pnpm", args: ["add", "react", "zod"] }],
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
