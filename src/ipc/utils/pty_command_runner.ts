import { spawn as spawnProcess } from "node:child_process";
import { spawn as spawnPty } from "node-pty";
import {
  BoundedOutputBuffer,
  DEFAULT_MAX_BUFFERED_OUTPUT_BYTES,
} from "./bounded_output_buffer";

const DEFAULT_PTY_NAME = "xterm-color";
const DEFAULT_PTY_COLS = 160;
const DEFAULT_PTY_ROWS = 24;
export const DEFAULT_PTY_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

const ANSI_OSC_PATTERN = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;
const ANSI_CSI_PATTERN = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/g;
const ANSI_SINGLE_CHAR_PATTERN = /\u001B[@-Z\\-_]/g;
const MAX_UNTERMINATED_OSC_CHARACTERS = 8 * 1024;

type AnsiParserState = "text" | "escape" | "csi" | "osc" | "osc-escape";

/**
 * Removes terminal control sequences before output enters the bounded buffer.
 * The parser state spans PTY chunks so truncation can never expose the middle
 * of an ANSI sequence as user-visible text.
 */
class StreamingAnsiStripper {
  private state: AnsiParserState = "text";
  private oscCharacters = 0;

  write(value: string): string {
    let output = "";
    let visibleStart = this.state === "text" ? 0 : -1;

    const enterControlSequence = (
      index: number,
      state: Exclude<AnsiParserState, "text">,
    ) => {
      if (visibleStart >= 0) {
        output += value.slice(visibleStart, index);
      }
      visibleStart = -1;
      this.state = state;
    };

    const resumeText = (nextIndex: number) => {
      this.state = "text";
      this.oscCharacters = 0;
      visibleStart = nextIndex;
    };

    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);

      switch (this.state) {
        case "text":
          if (code === 0x1b) {
            enterControlSequence(index, "escape");
          } else if (code === 0x9b) {
            enterControlSequence(index, "csi");
          }
          break;
        case "escape":
          if (value[index] === "[") {
            this.state = "csi";
          } else if (value[index] === "]") {
            this.state = "osc";
            this.oscCharacters = 0;
          } else if (code >= 0x40 && code <= 0x5f) {
            resumeText(index + 1);
          } else {
            // Match normalizePtyOutput's behavior for an unknown escape:
            // discard ESC but preserve the following visible character.
            output += value[index];
            resumeText(index + 1);
          }
          break;
        case "csi":
          if (code >= 0x40 && code <= 0x7e) {
            resumeText(index + 1);
          }
          break;
        case "osc":
          this.oscCharacters += 1;
          if (code === 0x07) {
            resumeText(index + 1);
          } else if (code === 0x0a) {
            // OSC payloads cannot contain line feeds. Recover from malformed
            // output so an unterminated title sequence cannot hide every
            // later user-visible error line.
            resumeText(index + 1);
          } else if (this.oscCharacters >= MAX_UNTERMINATED_OSC_CHARACTERS) {
            // Also recover when a producer never emits a line break or OSC
            // terminator. Discard the bounded malformed prefix and resume.
            resumeText(index + 1);
          } else if (code === 0x1b) {
            this.state = "osc-escape";
          }
          break;
        case "osc-escape":
          this.oscCharacters += 1;
          if (value[index] === "\\") {
            resumeText(index + 1);
          } else if (code === 0x0a) {
            resumeText(index + 1);
          } else if (this.oscCharacters >= MAX_UNTERMINATED_OSC_CHARACTERS) {
            resumeText(index + 1);
          } else if (code !== 0x1b) {
            this.state = "osc";
          }
          break;
      }
    }

    if (this.state === "text" && visibleStart >= 0) {
      output += value.slice(visibleStart);
    }

    return output;
  }
}

export interface PtyCommandExecutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  cols?: number;
  rows?: number;
  name?: string;
  displayCommand?: string;
  maxOutputBytes?: number;
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

export type PtySpawner = (
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

export function terminatePtyProcess(
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
    const outputBuffer = new BoundedOutputBuffer(
      options.maxOutputBytes ?? DEFAULT_MAX_BUFFERED_OUTPUT_BYTES,
    );
    const ansiStripper = new StreamingAnsiStripper();
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
      outputBuffer.append(ansiStripper.write(chunk));
    });

    exitSubscription = ptyProcess.onExit(({ exitCode, signal }) => {
      const failed = exitCode !== 0 || hasSignal(signal);
      const output = normalizePtyOutput(outputBuffer.toString(), {
        preserveCarriageReturnFrames: failed,
      });
      outputBuffer.clear();

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
      const timeoutMessage = buildTimeoutMessage(displayedCommand, timeoutMs);
      const output = appendCommandMessage(
        normalizePtyOutput(outputBuffer.toString(), {
          preserveCarriageReturnFrames: true,
        }),
        timeoutMessage,
      );
      outputBuffer.clear();

      settle(() =>
        reject(
          new PtyCommandExecutionError({
            message: timeoutMessage,
            output,
          }),
        ),
      );

      try {
        terminatePtyProcess(ptyProcess);
      } catch {
        // Best effort only. The timeout error above remains the source of truth.
      }
    }, timeoutMs);
  });
}
