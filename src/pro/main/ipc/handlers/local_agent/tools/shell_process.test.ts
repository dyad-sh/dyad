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

it("bounds Windows encoded command lines before spawning", () => {
  const invocation = shellInvocation("#".repeat(9000), "win32");
  expect(
    [invocation.command, ...invocation.args].join(" ").length,
  ).toBeLessThan(32767);
  expect(() => shellInvocation("#".repeat(9001), "win32")).toThrow("9000");
  expect(() => shellInvocation("#".repeat(16000), "darwin")).not.toThrow();
});
it("uses Continue for Windows native stderr while preserving exit codes", () => {
  const invocation = shellInvocation("node.exe --version", "win32");
  const script = Buffer.from(invocation.args.at(-1)!, "base64").toString(
    "utf16le",
  );
  expect(script).toContain("$ErrorActionPreference = 'Continue'");
  expect(script).toContain("$dyadShellSucceeded = $?");
  expect(script).not.toContain("exit $LASTEXITCODE");
});
it.skipIf(process.platform !== "win32")(
  "continues past native warnings and reports the final successful cmdlet",
  async () => {
    const nodePath = process.execPath.replaceAll("'", "''");
    for (const code of [0, 7]) {
      const result = await runShellProcess({
        command: `& '${nodePath}' -e 'process.stderr.write("warning\\n"); process.exit(${code});'\nWrite-Output 'continued'`,
        cwd: process.cwd(),
        timeoutMs: 10000,
        onOutput: vi.fn(),
      });
      expect(result.stdout).toContain("continued");
      expect(result.stderr).toContain("warning");
      expect(result.code).toBe(0);
      expect(result.status).toBe("completed");
    }
  },
);

it("preserves cloud profiles, proxies, trust stores, and Windows context", () => {
  const context = {
    KUBECONFIG: "/config/kube",
    AWS_PROFILE: "app",
    AWS_REGION: "us-west-2",
    AWS_ACCESS_KEY_ID: "cli-credential",
    CLOUDSDK_CONFIG: "/config/gcloud",
    CLOUDSDK_CORE_PROJECT: "app-project",
    GOOGLE_APPLICATION_CREDENTIALS: "/config/google.json",
    XDG_CONFIG_HOME: "/config",
    HTTPS_PROXY: "http://proxy",
    NO_PROXY: "localhost",
    SSL_CERT_FILE: "/ca.pem",
    NODE_EXTRA_CA_CERTS: "/node-ca.pem",
    USERNAME: "user",
    ProgramData: "C:\\ProgramData",
    PSModulePath: "C:\\Modules",
    APP_FEATURE: "enabled",
  };
  expect(shellEnvironment(context)).toEqual(context);
});
it("denies Dyad/provider secrets and startup injection case-insensitively", () => {
  expect(
    shellEnvironment({
      DYAD_PRO_API_KEY: "secret",
      dyad_engine_key: "secret",
      ANTHROPIC_API_KEY: "secret",
      GEMINI_API_KEY: "secret",
      BASH_ENV: "/hook",
      ENV: "/hook",
      PROMPT_COMMAND: "hook",
      node_options: "--require=/hook",
      PYTHONSTARTUP: "/hook",
      LD_PRELOAD: "/hook",
      DYLD_INSERT_LIBRARIES: "/hook",
      PATH: "/bin",
    }),
  ).toEqual({ PATH: "/bin" });
});

it.skipIf(process.platform !== "win32")(
  "uses the final PowerShell step rather than stale native exit codes",
  async () => {
    const nodePath = process.execPath.replaceAll("'", "''");
    for (const [command, code] of [
      [
        `& '${nodePath}' -e 'process.exit(0)'; Get-Item __dyad_missing_file__`,
        1,
      ],
      [`& '${nodePath}' -e 'process.exit(7)'; Write-Output ok`, 0],
      [`& '${nodePath}' -e 'process.exit(7)'`, 1],
      [`Write-Output ok; exit 7`, 7],
    ] as const) {
      const result = await runShellProcess({
        command,
        cwd: process.cwd(),
        timeoutMs: 10000,
        onOutput: vi.fn(),
      });
      expect(result.code).toBe(code);
      expect(result.status).toBe(code === 0 ? "completed" : "failed");
    }
  },
);
