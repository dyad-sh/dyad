import { spawn, type ChildProcess } from "child_process";
import treeKill from "tree-kill";
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
 *
 * SECURITY (Windows): on Windows this spawns with `shell: true` so `.cmd`
 * shims like `npm`/`npx` resolve. Node passes the args array through the shim
 * but certain metacharacters can still be interpreted by `cmd.exe`. Callers
 * MUST NOT pass unvalidated/user-controlled strings in `command` or `args`;
 * validate or sanitize them first (existing callers pass only fixed commands
 * and validated paths).
 */
export async function spawnStreaming({
  command,
  args = [],
  cwd,
  env,
  signal,
  onOutput,
  onProcess,
}: {
  command: string;
  /** Arguments passed as an array so they're never parsed by a shell. */
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  onProcess?: (child: ChildProcess) => void;
}): Promise<SpawnStreamingResult> {
  return new Promise<SpawnStreamingResult>((resolve, reject) => {
    logger.info(`Running (streaming): ${command} ${args.join(" ")}`);

    // Pass a copy of the environment rather than the live global object to
    // avoid concurrent mutation side effects.
    let spawnEnv: NodeJS.ProcessEnv;
    if (env) {
      spawnEnv = { ...env };
    } else {
      spawnEnv = { ...process.env };
    }

    // Never run through a shell on Unix: a shell would parse metacharacters in
    // arguments (e.g. a test path containing `$(...)` or backticks), enabling
    // command injection. Windows needs a shell to resolve `.cmd` shims like
    // `npm`/`npx`, and passes args via the safe array form.
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: "pipe",
      env: spawnEnv,
    });
    onProcess?.(child);

    let stdout = "";
    let stderr = "";
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      logger.info(`Aborting: ${command}`);
      // Kill the whole process tree — with a shell (Windows) or fast package
      // managers, the spawned child forks descendants (npx/playwright/chromium)
      // that a plain child.kill() would leave orphaned.
      if (child.pid) {
        treeKill(child.pid, "SIGTERM", (err) => {
          if (err) {
            logger.warn(`Failed to tree-kill streaming process: ${err}`);
          }
        });
      } else {
        try {
          child.kill("SIGTERM");
        } catch (err) {
          logger.warn(`Failed to kill streaming process: ${err}`);
        }
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
