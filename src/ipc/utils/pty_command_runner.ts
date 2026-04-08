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
}

export interface PtyCommandExecutionResult {
  output: string;
}

export class PtyCommandExecutionError extends Error {
  output: string;
  exitCode: number | null;

  constructor({
    message,
    output = "",
    exitCode = null,
  }: {
    message: string;
    output?: string;
    exitCode?: number | null;
  }) {
    super(message);
    this.name = "PtyCommandExecutionError";
    this.output = output;
    this.exitCode = exitCode;
  }
}

export interface PtyProcessLike {
  kill(signal?: string): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void;
  };
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

function buildDisplayedCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function stripAnsiSequences(value: string): string {
  return value
    .replace(ANSI_OSC_PATTERN, "")
    .replace(ANSI_CSI_PATTERN, "")
    .replace(ANSI_SINGLE_CHAR_PATTERN, "");
}

export function normalizePtyOutput(value: string): string {
  const strippedValue = stripAnsiSequences(value).replace(/\r\n/g, "\n");
  const normalizedLines: string[] = [];
  let currentLine = "";

  for (const character of strippedValue) {
    if (character === "\r") {
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
    const displayedCommand = buildDisplayedCommand(command, args);
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

    exitSubscription = ptyProcess.onExit(({ exitCode }) => {
      const output = normalizePtyOutput(outputChunks.join(""));

      if (exitCode === 0) {
        settle(() => resolve({ output }));
        return;
      }

      settle(() =>
        reject(
          new PtyCommandExecutionError({
            message: `Command '${displayedCommand}' exited with code ${exitCode}`,
            output,
            exitCode,
          }),
        ),
      );
    });

    timeoutId = setTimeout(() => {
      try {
        ptyProcess.kill();
      } catch {
        // Best effort only. The timeout error below remains the source of truth.
      }

      settle(() =>
        reject(
          new PtyCommandExecutionError({
            message: `Command '${displayedCommand}' timed out after ${timeoutMs}ms`,
            output: normalizePtyOutput(outputChunks.join("")),
          }),
        ),
      );
    }, timeoutMs);
  });
}
