import { describe, expect, it, vi } from "vitest";
import {
  buildAddDependencyCommands,
  ensureSocketFirewallInstalled,
  SOCKET_FIREWALL_WARNING_MESSAGE,
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
