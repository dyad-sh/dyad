import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import path from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import treeKill from "tree-kill";

const execFileAsync = promisify(execFile);
export const READ_TOOLS = ["Read", "Glob", "Grep"];
export const WRITE_TOOLS = ["Edit", "Write"];
const running = new Set<ChildProcess>();

// No provider keys, proxy overrides, credential helpers or inherited Claude
// switches. Authentication stays inside the official CLI and OS keychain.
export function claudeEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    [
      "HOME",
      "USERPROFILE",
      "PATH",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "USER",
      "LOGNAME",
    ].flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])),
  );
}

export async function findClaudeExecutable(): Promise<string> {
  const binary = process.platform === "win32" ? "claude.exe" : "claude";
  const candidates = [
    path.join(homedir(), ".local", "bin", binary),
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, binary)),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* try next native binary */
    }
  }
  throw new Error(
    "Install the official Claude Code native CLI, then run claude auth login in your terminal.",
  );
}

export async function claudeStatus() {
  try {
    const executable = await findClaudeExecutable();
    const options = {
      env: claudeEnvironment(),
      timeout: 10_000,
      maxBuffer: 64_000,
      windowsHide: true,
    };
    const { stdout: versionText } = await execFileAsync(
      executable,
      ["--version"],
      options,
    );
    const version = versionText.match(/\d+\.\d+\.\d+/)?.[0] ?? "unknown";
    const [major, minor, patch] = version.split(".").map(Number);
    const compatible = major === 2 && minor === 1 && patch >= 259;
    const { stdout } = await execFileAsync(
      executable,
      ["auth", "status"],
      options,
    );
    const auth = z
      .object({
        loggedIn: z.boolean(),
        authMethod: z.string().optional(),
        subscriptionType: z.string().nullable().optional(),
      })
      .parse(JSON.parse(stdout));
    const connected = auth.loggedIn && auth.authMethod === "claude.ai";
    return {
      installed: true,
      connected,
      compatible,
      version,
      detail: !compatible
        ? "This prototype requires Claude Code 2.1.259 or later in the 2.1 series."
        : connected
          ? "Signed in through the official Claude Code CLI."
          : "Run claude auth login in your terminal to use your subscription.",
    };
  } catch {
    return {
      installed: false,
      connected: false,
      compatible: false,
      version: null,
      detail:
        "Install Claude Code from code.claude.com, then run claude auth login in your terminal. Dyad never collects subscription credentials.",
    };
  }
}

export type CliEvent = Record<string, any>;
export interface BackendTurn {
  cwd: string;
  prompt: string;
  model: string;
  sessionId: string;
  resume: boolean;
  readOnly: boolean;
  signal: AbortSignal;
  mcpConfigPath: string;
  onEvent(event: CliEvent): Promise<void>;
}

export function claudeArguments(
  turn: Omit<BackendTurn, "onEvent" | "signal">,
): string[] {
  return [
    "-p",
    "--restricted",
    "--disable-slash-commands",
    "--no-chrome",
    "--strict-mcp-config",
    "--mcp-config",
    turn.mcpConfigPath,
    "--settings",
    JSON.stringify({
      disableAllHooks: true,
      enabledPlugins: {},
      autoMemoryEnabled: false,
    }),
    "--tools",
    [...READ_TOOLS, ...(turn.readOnly ? [] : WRITE_TOOLS)].join(","),
    "--disallowedTools",
    [
      "Bash",
      "PowerShell",
      "Agent",
      "Task",
      "Skill",
      "WebFetch",
      "WebSearch",
      ...(turn.readOnly ? WRITE_TOOLS : []),
    ].join(","),
    "--permission-mode",
    "manual",
    "--permission-prompt-tool",
    "mcp__dyad__permission",
    "--model",
    turn.model,
    turn.resume ? "--resume" : "--session-id",
    turn.sessionId,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
}

/** Streaming backend boundary. The CLI owns the agent loop; Dyad never feeds
 * these events back through its AI-SDK model/tool loop. */
export async function runClaudeTurn(turn: BackendTurn): Promise<void> {
  turn.signal.throwIfAborted();
  const executable = await findClaudeExecutable();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, claudeArguments(turn), {
      cwd: turn.cwd,
      env: claudeEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    running.add(child);
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    let failure: Error | undefined;
    let events = Promise.resolve();
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const signalProcess = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, signal);
        else if (child.pid) treeKill(child.pid, signal, () => {});
      } catch {
        /* already exited */
      }
    };
    const abort = () => {
      signalProcess("SIGINT");
      killTimer ??= setTimeout(() => signalProcess("SIGKILL"), 5000);
    };
    const consume = (line: string) => {
      if (!line.trim()) return;
      events = events
        .then(async () => {
          if (failure) return;
          const parsed: CliEvent = JSON.parse(line);
          await turn.onEvent(parsed);
        })
        .catch((error) => {
          failure =
            error instanceof Error ? error : new Error("Invalid CLI stream");
          abort();
        });
    };
    child.stdout.on("data", (data: Buffer) => {
      child.stdout.pause();
      buffer += decoder.write(data);
      if (buffer.length > 8 * 1024 * 1024) {
        failure = new Error("Claude Code stream frame exceeded limit");
        abort();
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      void events.finally(() => child.stdout.resume());
    });
    // Drain stderr without copying arbitrary CLI diagnostics/credentials into logs.
    child.stderr.resume();
    child.stdin.on("error", () => {
      /* process-close path reports failure */
    });
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => {
      running.delete(child);
      turn.signal.removeEventListener("abort", abort);
      if (killTimer) clearTimeout(killTimer);
      consume(buffer + decoder.end());
      void events.then(() =>
        failure
          ? reject(failure)
          : code !== 0 && !turn.signal.aborted
            ? reject(
                new Error(
                  `Claude Code exited (${code ?? "signal"}). Check official CLI authentication or usage limits.`,
                ),
              )
            : resolve(),
      );
    });
    turn.signal.addEventListener("abort", abort, { once: true });
    if (turn.signal.aborted) abort();
    child.stdin.end(turn.prompt);
  });
}

export function stopClaudeProcesses(): void {
  for (const child of running) {
    try {
      if (process.platform !== "win32" && child.pid)
        process.kill(-child.pid, "SIGKILL");
      else if (child.pid) treeKill(child.pid, "SIGKILL", () => {});
    } catch {
      /* already exited */
    }
  }
}
