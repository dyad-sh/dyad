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
  timeoutMs,
}: {
  command: string;
  /** Arguments passed as an array so they're never parsed by a shell. */
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  onProcess?: (child: ChildProcess) => void;
  /**
   * If set, tree-kill the process after this many ms of running. Surfaces as a
   * non-zero exit (with `aborted: false`) so callers classify it as a failure
   * rather than hanging forever on a stuck download or an unexpected prompt.
   */
  timeoutMs?: number;
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
    // stdin is 'ignore', not 'pipe': an open, never-written stdin pipe lets a
    // child (notably `npm install`) block forever if it ever tries to prompt —
    // e.g. a registry auth prompt or an ERESOLVE confirmation. Giving it EOF
    // makes those reads fail fast instead of hanging the whole flow.
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: spawnEnv,
    });
    onProcess?.(child);

    let stdout = "";
    let stderr = "";
    let aborted = false;
    let timedOut = false;

    const killTree = (reason: string) => {
      logger.info(`${reason}: ${command}`);
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

    const timer =
      timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            onOutput?.(
              `\nTimed out after ${Math.round(timeoutMs / 1000)}s — stopping.\n`,
            );
            killTree("Timed out");
          }, timeoutMs)
        : undefined;

    const onAbort = () => {
      aborted = true;
      killTree("Aborting");
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
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      // A timeout kill leaves `code` null (or a signal exit); normalize it to a
      // non-zero code so callers treat it as a failure, not a clean exit.
      const exitCode = timedOut && (code === null || code === 0) ? 124 : code;
      resolve({ code: exitCode, stdout, stderr, aborted });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      logger.error(`Failed to spawn command: ${command}`, err);
      reject(err);
    });
  });
}
