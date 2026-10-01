import { app } from "electron";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import treeKill from "tree-kill";
import { PROVIDER_TO_ENV_VAR } from "@/ipc/shared/language_model_constants";
import { BoundedOutputBuffer } from "@/ipc/utils/bounded_output_buffer";
import { buildWindowsCommandInvocation } from "@/ipc/utils/windows_command";

const activeShellPids = new Set<number>();
export const SHELL_SHUTDOWN_TIMEOUT_MS = 3_000;
let quitCleanupRegistered = false;
export function maxShellCommandLength(platform = process.platform): number {
  // UTF-16 + base64 expands each Windows code unit to ~2.7 command-line characters.
  // Leave space for the executable, switches, and wrapper under CreateProcess's 32K limit.
  return platform === "win32" ? 9_000 : 16_000;
}

function registerQuitCleanup() {
  if (quitCleanupRegistered || !app?.once) return;
  quitCleanupRegistered = true;
  app.once("will-quit", () => {
    // Electron does not await promises during quit. Deliver termination synchronously.
    for (const pid of activeShellPids) {
      if (process.platform === "win32") {
        spawnSync(
          path.win32.join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          ["/pid", String(pid), "/T", "/F"],
          { shell: false, stdio: "ignore", timeout: 5000 },
        );
      } else {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* Already exited. */
        }
      }
    }
  });
}

/** Preserve host CLI configuration/authentication, excluding Dyad secrets and startup injection. */
export function shellEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const denied = new Set([
    ...Object.values(PROVIDER_TO_ENV_VAR),
    "GOOGLE_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "BASH_ENV",
    "ENV",
    "PROMPT_COMMAND",
    "SHELLOPTS",
    "BASHOPTS",
    "CDPATH",
    "GLOBIGNORE",
    "ZDOTDIR",
    "NODE_OPTIONS",
    "NODE_PATH",
    "ELECTRON_RUN_AS_NODE",
    "PYTHONSTARTUP",
    "PYTHONPATH",
    "RUBYOPT",
    "RUBYLIB",
    "PERL5OPT",
    "PERL5LIB",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
  ]);
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => {
      const normalized = key.toUpperCase();
      return (
        !denied.has(normalized) &&
        !normalized.startsWith("DYAD_") &&
        !normalized.startsWith("DYLD_")
      );
    }),
  );
}

export function shellInvocation(command: string, platform = process.platform) {
  if (command.length > maxShellCommandLength(platform))
    throw new RangeError(
      `Shell command exceeds ${maxShellCommandLength(platform)} characters on this platform.`,
    );
  if (platform === "win32") {
    const executable = path.win32.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    // EncodedCommand preserves arbitrary quotes, newlines, and Unicode without cmd.exe.
    // Windows PowerShell 5.1 treats native stderr as error records. Continue lets
    // warnings flow while LASTEXITCODE still determines native command failure.
    const script = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n$ErrorActionPreference = 'Continue'\n${command}\n$dyadShellSucceeded = $?\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }\nif (-not $dyadShellSucceeded) { exit 1 }\n`;
    return buildWindowsCommandInvocation(
      executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      platform,
    );
  }
  return {
    command: "/bin/bash",
    args: ["--noprofile", "--norc", "-c", command],
  };
}

export interface ShellProcessResult {
  executed: boolean;
  code: number | null;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  stdout: string;
  stderr: string;
  truncated: boolean;
  /** Pipes or process-tree termination could not be confirmed before the hard deadline. */
  shutdownUnconfirmed?: true;
}

export function runShellProcess(
  {
    command,
    cwd,
    timeoutMs,
    signal,
    onOutput,
  }: {
    command: string;
    cwd: string;
    timeoutMs: number;
    signal?: AbortSignal;
    onOutput: (text: string) => void;
  },
  platform: NodeJS.Platform = process.platform,
): Promise<ShellProcessResult> {
  if (signal?.aborted)
    return Promise.resolve({
      executed: false,
      code: null,
      status: "cancelled",
      stdout: "",
      stderr: "",
      truncated: false,
    });
  registerQuitCleanup();
  const invocation = shellInvocation(command, platform);
  return new Promise((resolve, reject) => {
    const stdout = new BoundedOutputBuffer(64_000);
    const stderr = new BoundedOutputBuffer(64_000);
    const outDecoder = new StringDecoder("utf8");
    const errDecoder = new StringDecoder("utf8");
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: shellEnvironment(),
      shell: false,
      detached: platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid) activeShellPids.add(child.pid);
    let status: ShellProcessResult["status"] | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    let killPending: Promise<void> = Promise.resolve();
    let exited = false;
    let settled = false;
    let exitCode: number | null = null;
    const kill = (kind: "SIGTERM" | "SIGKILL") => {
      if (!child.pid) return;
      if (platform !== "win32") {
        try {
          process.kill(-child.pid, kind);
        } catch {
          /* Already exited. */
        }
      } else {
        if (exited) return;
        const pid = child.pid;
        killPending = new Promise<void>((done) =>
          treeKill(pid, kind, () => done()),
        );
      }
    };
    const stop = (next: "cancelled" | "timed_out") => {
      if (status || settled) return;
      status = next;
      kill("SIGTERM");
      if (platform !== "win32")
        forceTimer = setTimeout(() => kill("SIGKILL"), 1_000);
      // Escaped descendants can keep inherited pipes open after the root exits.
      // Never wait indefinitely or taskkill an exited/reused Windows root PID.
      shutdownTimer = setTimeout(
        () => finish(exitCode, true),
        SHELL_SHUTDOWN_TIMEOUT_MS,
      );
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timed_out"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const cleanup = (shutdownUnconfirmed = false) => {
      if (child.pid && (!shutdownUnconfirmed || exited))
        activeShellPids.delete(child.pid);
      clearTimeout(timer);
      clearTimeout(forceTimer);
      clearTimeout(shutdownTimer);
      signal?.removeEventListener("abort", abort);
    };
    const emit = (text: string) => {
      try {
        onOutput(text);
      } catch {
        /* A disconnected renderer must not release a live process. */
      }
    };
    const finish = (code: number | null, shutdownUnconfirmed = false) => {
      if (settled) return;
      settled = true;
      cleanup(shutdownUnconfirmed);
      if (shutdownUnconfirmed) {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
      }
      emit(outDecoder.end());
      emit(errDecoder.end());
      resolve({
        executed: true,
        code,
        status: status ?? (code === 0 ? "completed" : "failed"),
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        truncated: stdout.wasTruncated || stderr.wasTruncated,
        ...(shutdownUnconfirmed ? { shutdownUnconfirmed: true } : {}),
      });
    };
    child.once("exit", (code) => {
      exited = true;
      exitCode = code;
      // A late Unix exit must retire an unconfirmed root too, before PID reuse.
      // Normal Unix groups remain registered until close so quit can stop descendants.
      if ((platform === "win32" || settled) && child.pid)
        activeShellPids.delete(child.pid);
    });
    child.stdout.on("data", (data: Buffer) => {
      stdout.append(data);
      emit(outDecoder.write(data));
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr.append(data);
      emit(errDecoder.write(data));
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", async (code) => {
      if (settled) return;
      // Clean remaining Unix group members even if a command forked then exited.
      if (platform !== "win32") kill("SIGKILL");
      await killPending;
      finish(code);
    });
  });
}
