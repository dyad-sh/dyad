import { app } from "electron";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import treeKill from "tree-kill";
import { BoundedOutputBuffer } from "@/ipc/utils/bounded_output_buffer";
import { buildWindowsCommandInvocation } from "@/ipc/utils/windows_command";

const activeShellPids = new Set<number>();
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

/** Deliberate allowlist: never inherit engine keys or interpreter startup hooks. */
export function shellEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed = new Set([
    "path",
    "home",
    "userprofile",
    "systemroot",
    "windir",
    "comspec",
    "temp",
    "tmp",
    "tmpdir",
    "localappdata",
    "appdata",
    "programfiles",
    "programfiles(x86)",
    "lang",
    "lc_all",
    "lc_ctype",
    "pathext",
  ]);
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase())),
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
    let killPending: Promise<void> = Promise.resolve();
    let exited = false;
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
      if (status) return;
      status = next;
      kill("SIGTERM");
      if (platform !== "win32")
        forceTimer = setTimeout(() => kill("SIGKILL"), 1_000);
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timed_out"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const cleanup = () => {
      if (child.pid) activeShellPids.delete(child.pid);
      clearTimeout(timer);
      clearTimeout(forceTimer);
      signal?.removeEventListener("abort", abort);
    };
    const emit = (text: string) => {
      try {
        onOutput(text);
      } catch {
        /* A disconnected renderer must not release a live process. */
      }
    };
    child.once("exit", () => {
      exited = true;
      // Never target an exited Windows root PID, even while pipes are draining.
      if (platform === "win32" && child.pid) activeShellPids.delete(child.pid);
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
      cleanup();
      reject(error);
    });
    child.on("close", async (code) => {
      // Clean remaining Unix group members even if a command forked then exited.
      if (platform !== "win32") kill("SIGKILL");
      await killPending;
      cleanup();
      emit(outDecoder.end());
      emit(errDecoder.end());
      resolve({
        executed: true,
        code,
        status: status ?? (code === 0 ? "completed" : "failed"),
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        truncated: stdout.wasTruncated || stderr.wasTruncated,
      });
    });
  });
}
