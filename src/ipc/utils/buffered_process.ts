import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import treeKill from "tree-kill";
import {
  BoundedOutputBuffer,
  DEFAULT_MAX_BUFFERED_OUTPUT_BYTES,
} from "./bounded_output_buffer";

export const DEFAULT_BUFFERED_PROCESS_TIMEOUT_MS = 10 * 60 * 1000;
export const BUFFERED_PROCESS_FORCE_KILL_GRACE_MS = 5_000;

export interface BufferedProcessOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  captureOutputOnSuccess?: boolean;
  waitForCloseAfterForceKill?: boolean;
  onStdout?: (chunk: string, child: ChildProcess) => void;
  onStderr?: (chunk: string, child: ChildProcess) => void;
}

export interface BufferedProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  aborted: boolean;
  timedOut: boolean;
}

export class BufferedProcessSpawnError extends Error {
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, stdout: string, stderr: string) {
    super(message);
    this.name = "BufferedProcessSpawnError";
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (typeof chunk === "string") {
    return Buffer.from(chunk);
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk));
}

/**
 * Runs a piped child process with independent byte budgets for stdout and
 * stderr. Timeout and abort paths terminate the entire process tree and all
 * listeners are removed as soon as the promise settles.
 */
export async function runBufferedProcess(
  options: BufferedProcessOptions,
): Promise<BufferedProcessResult> {
  if (options.signal?.aborted) {
    return {
      code: null,
      signal: null,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      aborted: true,
      timedOut: false,
    };
  }

  const maxOutputBytes =
    options.maxOutputBytes ?? DEFAULT_MAX_BUFFERED_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_BUFFERED_PROCESS_TIMEOUT_MS;

  return new Promise<BufferedProcessResult>((resolve, reject) => {
    const stdoutBuffer = new BoundedOutputBuffer(maxOutputBytes);
    const stderrBuffer = new BoundedOutputBuffer(maxOutputBytes);
    const stdoutDecoder = options.onStdout
      ? new StringDecoder("utf8")
      : undefined;
    const stderrDecoder = options.onStderr
      ? new StringDecoder("utf8")
      : undefined;

    let child: ChildProcess;
    try {
      const spawnOptions = {
        cwd: options.cwd,
        shell: options.shell ?? options.args === undefined,
        stdio: "pipe" as const,
        env: options.env,
      };
      child = options.args
        ? spawn(options.command, options.args, spawnOptions)
        : spawn(options.command, spawnOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reject(new BufferedProcessSpawnError(message, "", ""));
      return;
    }

    let settled = false;
    let aborted = false;
    let timedOut = false;
    let timeoutId: NodeJS.Timeout | undefined;
    let forceKillId: NodeJS.Timeout | undefined;

    const snapshotOutput = (capture: boolean) => {
      const stdoutTruncated = stdoutBuffer.wasTruncated;
      const stderrTruncated = stderrBuffer.wasTruncated;
      const stdout = capture ? stdoutBuffer.toString() : "";
      const stderr = capture ? stderrBuffer.toString() : "";
      stdoutBuffer.clear();
      stderrBuffer.clear();
      return { stdout, stderr, stdoutTruncated, stderrTruncated };
    };

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (forceKillId) {
        clearTimeout(forceKillId);
      }
      options.signal?.removeEventListener("abort", handleAbort);
      child.stdout?.off("data", handleStdout);
      child.stderr?.off("data", handleStderr);
      child.off("close", handleClose);
      child.off("error", handleError);
    };

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const succeeded = code === 0 && !aborted && !timedOut;
      const output = snapshotOutput(
        !succeeded || options.captureOutputOnSuccess !== false,
      );
      resolve({ code, signal, ...output, aborted, timedOut });
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const { stdout, stderr } = snapshotOutput(true);
      reject(new BufferedProcessSpawnError(error.message, stdout, stderr));
    };

    const terminate = (signal: "SIGTERM" | "SIGKILL") => {
      if (child.pid) {
        treeKill(child.pid, signal, (error) => {
          if (error && !child.killed) {
            try {
              child.kill(signal);
            } catch {
              // Best effort. The force-kill fallback will still settle.
            }
          }
        });
        return;
      }

      try {
        child.kill(signal);
      } catch {
        // Best effort. The force-kill fallback will still settle.
      }
    };

    const requestTermination = () => {
      terminate("SIGTERM");
      forceKillId = setTimeout(() => {
        terminate("SIGKILL");
        if (!options.waitForCloseAfterForceKill) {
          finish(null, "SIGKILL");
        }
      }, BUFFERED_PROCESS_FORCE_KILL_GRACE_MS);
    };

    const invokeOutputCallback = (
      callback: BufferedProcessOptions["onStdout"],
      decoded: string,
    ): boolean => {
      if (!decoded || !callback) {
        return true;
      }

      try {
        callback(decoded, child);
        return true;
      } catch (error) {
        // A callback failure must not escape an EventEmitter listener and
        // crash the main process while leaving the child running.
        terminate("SIGKILL");
        fail(error instanceof Error ? error : new Error(String(error)));
        return false;
      }
    };

    function handleStdout(chunk: unknown) {
      const bytes = toBuffer(chunk);
      stdoutBuffer.append(bytes);
      if (stdoutDecoder) {
        invokeOutputCallback(options.onStdout, stdoutDecoder.write(bytes));
      }
    }

    function handleStderr(chunk: unknown) {
      const bytes = toBuffer(chunk);
      stderrBuffer.append(bytes);
      if (stderrDecoder) {
        invokeOutputCallback(options.onStderr, stderrDecoder.write(bytes));
      }
    }

    function handleClose(code: number | null, signal: NodeJS.Signals | null) {
      if (
        stdoutDecoder &&
        !invokeOutputCallback(options.onStdout, stdoutDecoder.end())
      ) {
        return;
      }
      if (
        stderrDecoder &&
        !invokeOutputCallback(options.onStderr, stderrDecoder.end())
      ) {
        return;
      }
      finish(code, signal);
    }

    function handleError(error: Error) {
      fail(error);
    }

    function handleAbort() {
      if (settled || aborted || timedOut) {
        return;
      }
      aborted = true;
      requestTermination();
    }

    child.stdout?.on("data", handleStdout);
    child.stderr?.on("data", handleStderr);
    child.once("close", handleClose);
    child.once("error", handleError);

    options.signal?.addEventListener("abort", handleAbort, { once: true });
    timeoutId = setTimeout(() => {
      if (settled || aborted) {
        return;
      }
      timedOut = true;
      requestTermination();
    }, timeoutMs);
  });
}
