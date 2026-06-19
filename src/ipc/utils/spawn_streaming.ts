import { spawn, type ChildProcess } from "child_process";
import log from "electron-log/main";

const logger = log.scope("spawn_streaming");

export interface SpawnStreamingResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** True if the process was terminated via the abort signal. */
  aborted: boolean;
}

/**
 * Like `simpleSpawn`, but streams output incrementally to a callback and
 * supports cancellation via an AbortSignal. Resolves with the exit code and
 * accumulated output instead of rejecting on a non-zero exit, so callers can
 * decide how to classify failures (infra vs. assertion).
 *
 * The `onProcess` hook hands the spawned child to the caller so it can be
 * tracked (e.g. for an external Stop button) in addition to the signal.
 */
export async function spawnStreaming({
  command,
  cwd,
  env,
  signal,
  onOutput,
  onProcess,
}: {
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  onProcess?: (child: ChildProcess) => void;
}): Promise<SpawnStreamingResult> {
  return new Promise<SpawnStreamingResult>((resolve, reject) => {
    logger.info(`Running (streaming): ${command}`);
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: "pipe",
      env,
    });
    onProcess?.(child);

    let stdout = "";
    let stderr = "";
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      logger.info(`Aborting: ${command}`);
      // Kill the whole process group where possible.
      try {
        child.kill("SIGTERM");
      } catch (err) {
        logger.warn(`Failed to kill streaming process: ${err}`);
      }
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.stdout?.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      onOutput?.(output);
    });

    child.stderr?.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      onOutput?.(output);
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, aborted });
    });

    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      logger.error(`Failed to spawn command: ${command}`, err);
      reject(err);
    });
  });
}
