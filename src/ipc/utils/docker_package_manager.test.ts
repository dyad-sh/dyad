import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandExecutionError } from "@/ipc/utils/socket_firewall";
import {
  resolveAppIdForPath,
  runPackageManagerCommandInGuest,
  wrapWithGuestSocketFirewall,
} from "./docker_package_manager";

const {
  appGuestInputMock,
  runGuestBufferedMock,
  assertDockerAvailableMock,
  selectFromMock,
} = vi.hoisted(() => ({
  appGuestInputMock: vi.fn(),
  runGuestBufferedMock: vi.fn(),
  assertDockerAvailableMock: vi.fn(),
  selectFromMock: vi.fn(),
}));

vi.mock("@/ipc/services/docker_runtime/guest_command", () => ({
  appGuestInput: appGuestInputMock,
  runGuestBuffered: runGuestBufferedMock,
  toGuestPath: (hostPath: string) => hostPath,
}));

vi.mock("@/ipc/services/docker_runtime/docker_cli", () => ({
  assertDockerAvailable: assertDockerAvailableMock,
}));

vi.mock("@/db", () => ({
  db: { select: () => ({ from: selectFromMock }) },
}));

vi.mock("@/paths/paths", () => ({
  getDyadAppPath: (appPath: string) =>
    path.isAbsolute(appPath) ? appPath : path.join("/apps", appPath),
}));

function bufferedResult(
  overrides: Partial<{
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }> = {},
) {
  return {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    aborted: false,
    timedOut: false,
    ...overrides,
  };
}

describe("wrapWithGuestSocketFirewall", () => {
  it("passes the package-manager argv as positional parameters", () => {
    const wrapped = wrapWithGuestSocketFirewall({
      command: "pnpm",
      args: ["add", "left-pad; touch /pwned"],
    });

    expect(wrapped.command).toBe("sh");
    expect(wrapped.args[0]).toBe("-c");
    expect(wrapped.args[1]).toMatch(/npx .*sfw@/);
    expect(wrapped.args[1]).not.toContain("left-pad");
    expect(wrapped.args.slice(2)).toEqual([
      "sh",
      "pnpm",
      "add",
      "left-pad; touch /pwned",
    ]);
  });

  describe.skipIf(process.platform === "win32")("the guest script", () => {
    const execFileAsync = promisify(execFile);

    async function runWithFakeNpx(npxScript: string) {
      const binDir = await mkdtemp(path.join(os.tmpdir(), "dyad-fake-npx-"));
      try {
        await writeFile(path.join(binDir, "npx"), npxScript);
        await chmod(path.join(binDir, "npx"), 0o755);
        const wrapped = wrapWithGuestSocketFirewall({
          command: "echo",
          args: ["ran", "a b"],
        });
        const { stdout } = await execFileAsync(wrapped.command, wrapped.args, {
          env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
        });
        return stdout;
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    }

    it("runs the command under the firewall when it is available", async () => {
      const stdout = await runWithFakeNpx(
        '#!/bin/sh\nfor last; do :; done\n[ "$last" = "--help" ] && exit 0\necho "firewalled:$*"\n',
      );
      expect(stdout).toMatch(/^firewalled:.*sfw@\S+ echo ran a b\n$/);
      expect(stdout).not.toContain("__DYAD_SOCKET_FIREWALL_UNAVAILABLE__");
    });

    it("falls back to the bare command with a marker when the firewall is unavailable", async () => {
      const stdout = await runWithFakeNpx("#!/bin/sh\nexit 1\n");
      expect(stdout).toBe("__DYAD_SOCKET_FIREWALL_UNAVAILABLE__\nran a b\n");
    });
  });
});

describe("runPackageManagerCommandInGuest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertDockerAvailableMock.mockResolvedValue(undefined);
    appGuestInputMock.mockImplementation(async (input) => ({
      ...input,
      marker: "guest-input",
    }));
  });

  it("runs the bare command in the app's guest and returns its output", async () => {
    runGuestBufferedMock.mockResolvedValue(
      bufferedResult({ stdout: "done", stderr: "warn" }),
    );

    const result = await runPackageManagerCommandInGuest({
      appId: 3,
      appPath: "/apps/demo",
      invocation: { command: "pnpm", args: ["add", "react"] },
      timeoutMs: 1234,
    });

    expect(result).toEqual({ stdout: "done", stderr: "warn" });
    expect(appGuestInputMock).toHaveBeenCalledWith({
      appId: 3,
      appPath: "/apps/demo",
      command: "pnpm",
      args: ["add", "react"],
      env: { npm_config_cache: "/apps/demo/node_modules/.npm-cache" },
    });
    expect(runGuestBufferedMock).toHaveBeenCalledWith(
      expect.objectContaining({ marker: "guest-input" }),
      { timeoutMs: 1234 },
    );
  });

  it("wraps the command with the firewall and reports when it was unavailable", async () => {
    runGuestBufferedMock.mockResolvedValue(
      bufferedResult({
        stdout: "__DYAD_SOCKET_FIREWALL_UNAVAILABLE__\ninstalled",
      }),
    );
    const onSocketFirewallUnavailable = vi.fn();

    const result = await runPackageManagerCommandInGuest({
      appId: 3,
      appPath: "/apps/demo",
      invocation: { command: "pnpm", args: ["add", "react"] },
      useSocketFirewall: true,
      onSocketFirewallUnavailable,
    });

    expect(appGuestInputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "sh",
        args: expect.arrayContaining(["pnpm", "add", "react"]),
      }),
    );
    expect(onSocketFirewallUnavailable).toHaveBeenCalledTimes(1);
    expect(result.stdout).toBe("installed");
  });

  it("throws CommandExecutionError with the guest output on failure", async () => {
    runGuestBufferedMock.mockResolvedValue(
      bufferedResult({ code: 1, stdout: "out", stderr: "ERR_PNPM_X boom" }),
    );

    const error = await runPackageManagerCommandInGuest({
      appId: 3,
      appPath: "/apps/demo",
      invocation: { command: "pnpm", args: ["add", "nope"] },
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(CommandExecutionError);
    expect(error).toMatchObject({
      message:
        "Command 'pnpm add nope' failed in the Docker runtime (exit code 1)",
      stdout: "out",
      stderr: "ERR_PNPM_X boom",
      exitCode: 1,
    });
  });

  it("does not start a guest when Docker is unavailable", async () => {
    assertDockerAvailableMock.mockRejectedValue(new Error("no docker"));

    await expect(
      runPackageManagerCommandInGuest({
        appId: 3,
        appPath: "/apps/demo",
        invocation: { command: "pnpm", args: ["install"] },
      }),
    ).rejects.toThrow("no docker");
    expect(runGuestBufferedMock).not.toHaveBeenCalled();
  });
});

describe("resolveAppIdForPath", () => {
  it("matches relative and absolute stored app paths", async () => {
    selectFromMock.mockResolvedValue([
      { id: 1, path: "other" },
      { id: 2, path: "demo" },
      { id: 3, path: "/custom/place" },
    ]);

    await expect(resolveAppIdForPath("/apps/demo")).resolves.toBe(2);
    await expect(resolveAppIdForPath("/custom/place/")).resolves.toBe(3);
    await expect(resolveAppIdForPath("/apps/missing")).rejects.toMatchObject({
      name: "DyadError",
    });
  });
});
