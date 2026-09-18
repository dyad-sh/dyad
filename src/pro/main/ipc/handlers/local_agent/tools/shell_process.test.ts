import { describe, expect, it, vi } from "vitest";
import {
  runShellProcess,
  shellEnvironment,
  shellInvocation,
} from "./shell_process";

describe("shell process", () => {
  it("preserves Windows metacharacters without cmd.exe", () => {
    const command = "Write-Output '50% café'\nWrite-Output \"a & b\"";
    const invocation = shellInvocation(command, "win32");
    expect(invocation.command).toMatch(/powershell\.exe$/);
    expect(invocation.args).toContain("-NoProfile");
    expect(
      Buffer.from(invocation.args.at(-1)!, "base64").toString("utf16le"),
    ).toContain(command);
  });
  it("strips credentials and startup hooks from the host environment", () => {
    expect(
      shellEnvironment({
        PATH: "/bin",
        HOME: "/home/user",
        OPENAI_API_KEY: "secret",
        BASH_ENV: "/evil",
        NODE_OPTIONS: "--require=evil",
      }),
    ).toEqual({ PATH: "/bin", HOME: "/home/user" });
  });
  it("does not spawn an already cancelled command", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await runShellProcess({
          command: "exit 99",
          cwd: process.cwd(),
          timeoutMs: 1000,
          signal: controller.signal,
          onOutput: vi.fn(),
        })
      ).status,
    ).toBe("cancelled");
  });
  it("executes multiline Unicode commands and preserves a nonzero exit", async () => {
    const command =
      process.platform === "win32"
        ? "Write-Output 'héllo'\nexit 7"
        : "printf 'héllo\\n'\nexit 7";
    const result = await runShellProcess({
      command,
      cwd: process.cwd(),
      timeoutMs: 5000,
      onOutput: vi.fn(),
    });
    expect(result.code).toBe(7);
    expect(result.stdout).toContain("héllo");
    expect(result.status).toBe("failed");
  });
  it("times out a foreground command", async () => {
    const command =
      process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30";
    const result = await runShellProcess({
      command,
      cwd: process.cwd(),
      timeoutMs: 150,
      onOutput: vi.fn(),
    });
    expect(result.status).toBe("timed_out");
  });
  it("caps retained output", async () => {
    const command =
      process.platform === "win32"
        ? "Write-Output ('x' * 100000)"
        : "printf '%100000s' x";
    const result = await runShellProcess({
      command,
      cwd: process.cwd(),
      timeoutMs: 5000,
      onOutput: vi.fn(),
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThan(65_000);
  });
});

it.skipIf(process.platform === "win32")(
  "cancellation stops a foreground descendant and preserves partial edits",
  async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-shell-cancel-"),
    );
    const controller = new AbortController();
    try {
      const result = await runShellProcess({
        command: "printf partial > result.txt\nsleep 30 &\necho $!\nwait",
        cwd: directory,
        timeoutMs: 5000,
        signal: controller.signal,
        onOutput: (chunk) => {
          if (/\d/.test(chunk)) controller.abort();
        },
      });
      expect(result.status).toBe("cancelled");
      expect(
        await fs.readFile(path.join(directory, "result.txt"), "utf8"),
      ).toBe("partial");
      const pid = Number(result.stdout.trim());
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);
