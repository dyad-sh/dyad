import { describe, expect, it, vi } from "vitest";
import {
  buildAddDependencyCommand,
  detectPreferredPackageManager,
  ensureSocketFirewallInstalled,
  SOCKET_FIREWALL_WARNING_MESSAGE,
  shouldUseCommandShell,
  type CommandRunner,
  type PackageManager,
} from "./socket_firewall";

describe("detectPreferredPackageManager", () => {
  it("prefers pnpm when available", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValue({ stdout: "10.0.0", stderr: "" });

    await expect(detectPreferredPackageManager(runner)).resolves.toBe("pnpm");
    expect(runner).toHaveBeenCalledWith("pnpm", ["--version"]);
  });

  it("falls back to npm when pnpm is unavailable", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockRejectedValue(new Error("ENOENT"));

    await expect(detectPreferredPackageManager(runner)).resolves.toBe("npm");
    expect(runner).toHaveBeenCalledWith("pnpm", ["--version"]);
  });
});

describe("buildAddDependencyCommand", () => {
  it.each<[PackageManager, boolean, { command: string; args: string[] }]>([
    ["pnpm", true, { command: "sfw", args: ["pnpm", "add", "react", "zod"] }],
    [
      "npm",
      true,
      {
        command: "sfw",
        args: ["npm", "install", "--legacy-peer-deps", "react", "zod"],
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
