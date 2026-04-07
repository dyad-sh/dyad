import { describe, expect, it, vi } from "vitest";
import {
  buildAddDependencyCommands,
  CommandExecutionError,
  ensureSocketFirewallInstalled,
  isSocketFirewallPolicyBlock,
  SOCKET_FIREWALL_WARNING_MESSAGE,
  shouldUseCommandShell,
  type CommandRunner,
} from "./socket_firewall";

describe("buildAddDependencyCommands", () => {
  it("prefixes package manager commands with sfw when enabled", () => {
    expect(buildAddDependencyCommands(["react", "zod"], true)).toEqual([
      {
        command: "sfw",
        args: ["pnpm", "add", "react", "zod"],
      },
      {
        command: "sfw",
        args: ["npm", "install", "--legacy-peer-deps", "react", "zod"],
      },
    ]);
  });

  it("uses direct pnpm and npm commands when disabled", () => {
    expect(buildAddDependencyCommands(["react"], false)).toEqual([
      {
        command: "pnpm",
        args: ["add", "react"],
      },
      {
        command: "npm",
        args: ["install", "--legacy-peer-deps", "react"],
      },
    ]);
  });
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
    expect(runner).toHaveBeenCalledWith("sfw", ["--help"]);
  });

  it("installs sfw when missing and returns available", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockRejectedValueOnce(new Error("sfw missing"))
      .mockResolvedValueOnce({ stdout: "installed", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    await expect(ensureSocketFirewallInstalled(runner)).resolves.toEqual({
      available: true,
    });
    expect(runner).toHaveBeenNthCalledWith(1, "sfw", ["--help"]);
    expect(runner).toHaveBeenNthCalledWith(2, "npm", ["install", "-g", "sfw"]);
    expect(runner).toHaveBeenNthCalledWith(3, "sfw", ["--help"]);
  });

  it("returns a warning when sfw cannot be installed", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockRejectedValueOnce(new Error("sfw missing"))
      .mockRejectedValueOnce(new Error("npm install failed"));

    await expect(ensureSocketFirewallInstalled(runner)).resolves.toEqual({
      available: false,
      warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
    });
  });
});

describe("shouldUseCommandShell", () => {
  it("uses a shell on Windows so npm-style .cmd shims can execute", () => {
    expect(shouldUseCommandShell("win32")).toBe(true);
  });

  it("avoids the shell on Unix platforms", () => {
    expect(shouldUseCommandShell("darwin")).toBe(false);
    expect(shouldUseCommandShell("linux")).toBe(false);
  });
});

describe("isSocketFirewallPolicyBlock", () => {
  it("detects explicit Socket Firewall policy blocks", () => {
    expect(
      isSocketFirewallPolicyBlock(
        new CommandExecutionError({
          message: "blocked by policy",
          stderr: "Socket Firewall blocked react\nPolicy: malware",
          exitCode: 1,
        }),
      ),
    ).toBe(true);
  });

  it("does not treat generic runtime failures as policy blocks", () => {
    expect(
      isSocketFirewallPolicyBlock(new Error("Socket Firewall timed out")),
    ).toBe(false);
  });
});
