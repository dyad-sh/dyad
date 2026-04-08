import { spawn as spawnProcess } from "node:child_process";
import { spawn as spawnPty } from "node-pty";

const DEFAULT_PTY_NAME = "xterm-color";
const DEFAULT_PTY_COLS = 160;
const DEFAULT_PTY_ROWS = 24;
export const DEFAULT_PTY_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

const ANSI_OSC_PATTERN = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;
const ANSI_CSI_PATTERN = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/g;
const ANSI_SINGLE_CHAR_PATTERN = /\u001B[@-Z\\-_]/g;

export interface PtyCommandExecutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  cols?: number;
  rows?: number;
  name?: string;
  displayCommand?: string;
}

export interface PtyCommandExecutionResult {
  output: string;
}

export interface NormalizePtyOutputOptions {
  preserveCarriageReturnFrames?: boolean;
}

export class PtyCommandExecutionError extends Error {
  output: string;
  exitCode: number | null;
  signal?: number;

  constructor({
    message,
    output = "",
    exitCode = null,
    signal,
  }: {
    message: string;
    output?: string;
    exitCode?: number | null;
    signal?: number;
  }) {
    super(message);
    this.name = "PtyCommandExecutionError";
    this.output = output;
    this.exitCode = exitCode;
    this.signal = signal;
  }
}

export interface PtyProcessLike {
  pid?: number;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void;
  };
}

interface SpawnedProcessLike {
  once(event: "error", listener: () => void): SpawnedProcessLike;
  unref(): void;
}

type PtySpawner = (
  file: string,
  args: string[],
  options: {
    cols: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    encoding: "utf8";
    name: string;
    rows: number;
  },
) => PtyProcessLike;

type ProcessSpawner = (
  file: string,
  args: string[],
  options: {
    stdio: "ignore";
    windowsHide: true;
  },
) => SpawnedProcessLike;

function buildDisplayedCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function buildTimeoutMessage(
  displayedCommand: string,
  timeoutMs: number,
): string {
  return `Command '${displayedCommand}' timed out after ${formatDuration(timeoutMs)}. The command may be stuck. Check your network or environment and try again.`;
}

function appendCommandMessage(output: string, message: string): string {
  return output ? `${output}\n${message}` : message;
}

function stripAnsiSequences(value: string): string {
  return value
    .replace(ANSI_OSC_PATTERN, "")
    .replace(ANSI_CSI_PATTERN, "")
    .replace(ANSI_SINGLE_CHAR_PATTERN, "");
}

function formatDurationUnit(value: number, unit: string): string {
  if (unit === "ms") {
    return `${value} ${unit}`;
  }

  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return formatDurationUnit(durationMs, "ms");
  }

  if (durationMs % (60 * 1000) === 0) {
    return formatDurationUnit(durationMs / (60 * 1000), "minute");
  }

  if (durationMs % 1000 === 0) {
    return formatDurationUnit(durationMs / 1000, "second");
  }

  return formatDurationUnit(Math.ceil(durationMs / 1000), "second");
}

function hasSignal(signal: number | undefined): signal is number {
  return signal !== undefined && signal !== 0;
}

function buildExitMessage(
  displayedCommand: string,
  exitCode: number,
  signal: number | undefined,
): string {
  if (hasSignal(signal)) {
    return `Command '${displayedCommand}' was terminated by signal ${signal}`;
  }

  return `Command '${displayedCommand}' exited with code ${exitCode}`;
}

function terminatePtyProcess(
  ptyProcess: PtyProcessLike,
  platform: NodeJS.Platform = process.platform,
  processSpawner: ProcessSpawner = spawnProcess,
): void {
  if (platform === "win32" && typeof ptyProcess.pid === "number") {
    try {
      const taskkillProcess = processSpawner(
        "taskkill",
        ["/F", "/T", "/PID", String(ptyProcess.pid)],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
      taskkillProcess.once("error", () => {
        try {
          ptyProcess.kill();
        } catch {
          // Best effort only. The timeout error remains the source of truth.
        }
      });
      taskkillProcess.unref();
      return;
    } catch {
      // Fall back to the PTY kill below.
    }
  }

  ptyProcess.kill();
}

export function normalizePtyOutput(
  value: string,
  options: NormalizePtyOutputOptions = {},
): string {
  const strippedValue = stripAnsiSequences(value).replace(/\r\n/g, "\n");
  const normalizedLines: string[] = [];
  let currentLine = "";

  for (const character of strippedValue) {
    if (character === "\r") {
      if (options.preserveCarriageReturnFrames && currentLine) {
        normalizedLines.push(currentLine);
      }
      currentLine = "";
      continue;
    }

    if (character === "\n") {
      normalizedLines.push(currentLine);
      currentLine = "";
      continue;
    }

    if (character === "\b") {
      currentLine = currentLine.slice(0, -1);
      continue;
    }

    const codePoint = character.codePointAt(0) ?? 0;
    const isControlCharacter =
      codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
    if (isControlCharacter && character !== "\t") {
      continue;
    }

    currentLine += character;
  }

  if (currentLine) {
    normalizedLines.push(currentLine);
  }

  return normalizedLines.join("\n");
}

export async function runPtyCommand(
  command: string,
  args: string[],
  options: PtyCommandExecutionOptions = {},
  ptySpawner: PtySpawner = spawnPty,
): Promise<PtyCommandExecutionResult> {
  return new Promise((resolve, reject) => {
    const displayedCommand =
      options.displayCommand ?? buildDisplayedCommand(command, args);
    const timeoutMs = options.timeoutMs ?? DEFAULT_PTY_COMMAND_TIMEOUT_MS;
    const outputChunks: string[] = [];
    let didSettle = false;
    let timeoutId: NodeJS.Timeout | undefined;
    let dataSubscription: { dispose(): void } = { dispose: () => {} };
    let exitSubscription: { dispose(): void } = { dispose: () => {} };

    const settle = (callback: () => void) => {
      if (didSettle) {
        return;
      }

      didSettle = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      dataSubscription.dispose();
      exitSubscription.dispose();
      callback();
    };

    let ptyProcess: PtyProcessLike;
    try {
      ptyProcess = ptySpawner(command, args, {
        cols: options.cols ?? DEFAULT_PTY_COLS,
        cwd: options.cwd,
        env: options.env ?? process.env,
        encoding: "utf8",
        name: options.name ?? DEFAULT_PTY_NAME,
        rows: options.rows ?? DEFAULT_PTY_ROWS,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown PTY launch failure";
      reject(
        new PtyCommandExecutionError({
          message: `Failed to run command '${displayedCommand}': ${message}`,
        }),
      );
      return;
    }

    dataSubscription = ptyProcess.onData((chunk) => {
      outputChunks.push(chunk);
    });

    exitSubscription = ptyProcess.onExit(({ exitCode, signal }) => {
      const failed = exitCode !== 0 || hasSignal(signal);
      const output = normalizePtyOutput(outputChunks.join(""), {
        preserveCarriageReturnFrames: failed,
      });

      if (!failed) {
        settle(() => resolve({ output }));
        return;
      }

      settle(() =>
        reject(
          new PtyCommandExecutionError({
            message: buildExitMessage(displayedCommand, exitCode, signal),
            output,
            exitCode,
            signal,
          }),
        ),
      );
    });

    timeoutId = setTimeout(() => {
      try {
        terminatePtyProcess(ptyProcess);
      } catch {
        // Best effort only. The timeout error below remains the source of truth.
      }

      const timeoutMessage = buildTimeoutMessage(displayedCommand, timeoutMs);
      const output = appendCommandMessage(
        normalizePtyOutput(outputChunks.join(""), {
          preserveCarriageReturnFrames: true,
        }),
        timeoutMessage,
      );

      settle(() =>
        reject(
          new PtyCommandExecutionError({
            message: timeoutMessage,
            output,
          }),
        ),
      );
    }, timeoutMs);
  });
}
