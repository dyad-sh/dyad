import { describe, expect, it, vi } from "vitest";
import {
  buildAddDependencyCommand,
  detectPreferredPackageManager,
  ensureSocketFirewallInstalled,
  resolveExecutableName,
  SOCKET_FIREWALL_WARNING_MESSAGE,
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
    expect(runner).toHaveBeenCalledWith("npx", [
      "--prefer-offline",
      "--yes",
      "sfw@2.0.4",
      "--help",
    ]);
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
    expect(runner).toHaveBeenCalledWith("npx", [
      "--prefer-offline",
      "--yes",
      "sfw@2.0.4",
      "--help",
    ]);
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
