import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  buildSandboxCapabilitiesWithObserver,
  type SandboxHostCallObserver,
} from "./capabilities";
import {
  executeSandboxScriptInProcess,
  isSandboxSupportedPlatform,
  type SandboxRunResult,
} from "./execution";
import {
  clampSandboxWallClockTimeoutMs,
  clampSandboxTimeoutMs,
  SANDBOX_SCRIPT_SOURCE_LIMIT_BYTES,
  SANDBOX_WALL_CLOCK_TIMEOUT_MS,
  SANDBOX_WORKER_HEAP_LIMIT_MB,
} from "./limits";
import {
  createRemoteCallDispatcher,
  type RemoteCapabilityMap,
} from "./remote_capabilities";
import {
  deserializeSandboxWorkerError,
  type SandboxHostMessage,
  type SandboxWorkerInput,
  type SandboxWorkerMessage,
} from "./worker_protocol";

/**
 * A failure of the worker itself (it could not start, crashed outside the
 * script run, ran out of memory, or exited early), as opposed to an error
 * raised by the guest script.
 */
export class SandboxWorkerError extends DyadError {}

export function classifySandboxWorkerError(error: unknown): SandboxWorkerError {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (code === "ERR_WORKER_OUT_OF_MEMORY") {
    return new SandboxWorkerError(
      `Sandbox script ran out of memory (worker heap limit is ${SANDBOX_WORKER_HEAP_LIMIT_MB} MB).`,
      DyadErrorKind.Validation,
      { cause: error },
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new SandboxWorkerError(
    `Sandbox worker failed: ${message}`,
    DyadErrorKind.Internal,
    { cause: error },
  );
}

export { isSandboxSupportedPlatform };
export type { SandboxRunResult };

const WORKER_WALL_CLOCK_TIMEOUT_MARGIN_MS = 5_000;

export interface RunSandboxScriptParams {
  appPath: string;
  script: string;
  timeoutMs?: number;
  persistFullOutput?: boolean;
  onHostCall?: SandboxHostCallObserver;
  /**
   * Host functions that must execute on the main thread (write_file, MCP
   * tools). They are served over the worker's message port: the guest sees a
   * proxy with the same name, and each call runs here against the real
   * function with its result or error relayed back.
   */
  remoteCapabilities?: RemoteCapabilityMap;
  /** Terminates the worker when the owning turn is cancelled. */
  signal?: AbortSignal;
}

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.VITEST_WORKER_ID !== undefined
  );
}

function resolveSandboxWorkerPath(): string | undefined {
  if (isTestRuntime()) {
    // Vitest cannot run the TypeScript worker entry directly. A test that
    // builds the worker bundle can point the runner at the output.
    const override = process.env.DYAD_SANDBOX_WORKER_PATH;
    if (override) {
      return override;
    }
  }
  const workerPath = path.join(__dirname, "sandbox_worker.js");
  if (fs.existsSync(workerPath)) {
    return workerPath;
  }
  if (isTestRuntime()) {
    return undefined;
  }
  throw new DyadError(
    "Sandbox worker script is missing from the application build.",
    DyadErrorKind.Internal,
  );
}

function cancelledError(): DyadError {
  return new DyadError(
    "Sandbox script cancelled.",
    DyadErrorKind.UserCancelled,
  );
}

function runSandboxScriptInWorker(
  params: RunSandboxScriptParams & { timeoutMs: number },
): Promise<SandboxRunResult> {
  if (params.signal?.aborted) {
    return Promise.reject(cancelledError());
  }

  const workerPath = resolveSandboxWorkerPath();
  if (!workerPath) {
    // Test runtime without a built worker: run in-process with the same
    // merged capability map the worker would build.
    const capabilities = params.remoteCapabilities
      ? {
          ...(buildSandboxCapabilitiesWithObserver(
            params.appPath,
            params.onHostCall,
          ) as unknown as RemoteCapabilityMap),
          ...params.remoteCapabilities,
        }
      : undefined;
    return executeSandboxScriptInProcess({
      appPath: params.appPath,
      script: params.script,
      timeoutMs: params.timeoutMs,
      persistFullOutput: params.persistFullOutput,
      onHostCall: params.onHostCall,
      capabilities,
    });
  }

  const remoteCapabilities = params.remoteCapabilities ?? {};
  const input: SandboxWorkerInput = {
    appPath: params.appPath,
    script: params.script,
    timeoutMs: params.timeoutMs,
    persistFullOutput: params.persistFullOutput,
    remoteCapabilityNames: Object.keys(remoteCapabilities),
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerPath, {
      workerData: input,
      // A worker that exhausts the shared V8 heap aborts the whole process;
      // with a limit it terminates alone with ERR_WORKER_OUT_OF_MEMORY.
      resourceLimits: { maxOldGenerationSizeMb: SANDBOX_WORKER_HEAP_LIMIT_MB },
    });
    const dispatcher = createRemoteCallDispatcher(
      remoteCapabilities,
      (message: SandboxHostMessage) => {
        // A reply for a worker that has already been terminated is dropped;
        // nothing is waiting for it.
        if (!settled) {
          worker.postMessage(message);
        }
      },
    );
    const wallClockTimeoutMs = clampSandboxWallClockTimeoutMs(undefined);
    const wallClockTimeout = setTimeout(() => {
      settle(
        () =>
          reject(
            new DyadError(
              `Sandbox host execution timed out after ${SANDBOX_WALL_CLOCK_TIMEOUT_MS}ms.`,
              DyadErrorKind.External,
            ),
          ),
        true,
      );
    }, wallClockTimeoutMs + WORKER_WALL_CLOCK_TIMEOUT_MARGIN_MS);

    let vmElapsedMs = 0;
    let vmRunningSince: number | undefined;
    let vmPauseDepth = 0;
    let vmTimeout: NodeJS.Timeout | undefined;

    function clearVmTimeout() {
      if (vmTimeout) {
        clearTimeout(vmTimeout);
        vmTimeout = undefined;
      }
    }

    function scheduleVmTimeout() {
      clearVmTimeout();
      if (vmPauseDepth > 0 || vmRunningSince === undefined) {
        return;
      }
      const remainingMs = params.timeoutMs - vmElapsedMs;
      if (remainingMs <= 0) {
        settle(
          () =>
            reject(
              new DyadError(
                `Sandbox script timed out after ${params.timeoutMs}ms of VM execution.`,
                DyadErrorKind.External,
              ),
            ),
          true,
        );
        return;
      }
      vmTimeout = setTimeout(() => {
        if (vmRunningSince !== undefined) {
          vmElapsedMs += Date.now() - vmRunningSince;
          vmRunningSince = Date.now();
        }
        scheduleVmTimeout();
      }, remainingMs);
    }

    function startVmBudget() {
      if (vmRunningSince !== undefined) {
        return;
      }
      vmRunningSince = Date.now();
      scheduleVmTimeout();
    }

    function pauseVmBudget() {
      if (vmRunningSince !== undefined) {
        vmElapsedMs += Date.now() - vmRunningSince;
        vmRunningSince = undefined;
      }
      vmPauseDepth += 1;
      clearVmTimeout();
    }

    function resumeVmBudget() {
      if (vmPauseDepth === 0) {
        return;
      }
      vmPauseDepth -= 1;
      if (vmPauseDepth > 0 || vmRunningSince !== undefined) {
        return;
      }
      vmRunningSince = Date.now();
      scheduleVmTimeout();
    }

    const onAbort = () => {
      settle(() => reject(cancelledError()), true);
    };
    params.signal?.addEventListener("abort", onAbort, { once: true });

    function cleanup() {
      clearTimeout(wallClockTimeout);
      clearVmTimeout();
      params.signal?.removeEventListener("abort", onAbort);
      worker.removeAllListeners();
    }

    function settle(fn: () => void, terminate: boolean) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      fn();
      if (terminate) {
        void worker.terminate();
      }
    }

    worker.on("message", (message: SandboxWorkerMessage) => {
      if (settled) {
        return;
      }

      if (message.type === "vmBudgetStart") {
        startVmBudget();
        return;
      }

      if (message.type === "vmBudgetPause") {
        pauseVmBudget();
        return;
      }

      if (message.type === "vmBudgetResume") {
        resumeVmBudget();
        return;
      }

      if (message.type === "hostCall") {
        try {
          params.onHostCall?.(message.hostCall);
        } catch (error) {
          settle(() => reject(error), true);
        }
        return;
      }

      if (message.type === "remoteCall") {
        // The dispatcher reports every outcome, including a thrown
        // capability, back to the worker as a reply; it never rejects.
        void dispatcher.dispatch(message);
        return;
      }

      if (message.type === "result") {
        settle(() => resolve(message.result), true);
        return;
      }

      if (message.type === "error") {
        settle(
          () => reject(deserializeSandboxWorkerError(message.error)),
          true,
        );
        return;
      }

      settle(
        () =>
          reject(
            new DyadError(
              "Sandbox worker sent an unknown message.",
              DyadErrorKind.Internal,
            ),
          ),
        true,
      );
    });

    worker.on("error", (error) => {
      settle(() => reject(classifySandboxWorkerError(error)), true);
    });

    worker.on("exit", (code) => {
      settle(
        () =>
          reject(
            new SandboxWorkerError(
              code === 0
                ? "Sandbox worker exited without returning a result."
                : `Sandbox worker exited with code ${code}.`,
              DyadErrorKind.Internal,
            ),
          ),
        false,
      );
    });
  });
}

export async function runSandboxScript(
  params: RunSandboxScriptParams,
): Promise<SandboxRunResult> {
  if (
    Buffer.byteLength(params.script, "utf8") > SANDBOX_SCRIPT_SOURCE_LIMIT_BYTES
  ) {
    throw new DyadError(
      "Sandbox script is too large.",
      DyadErrorKind.Validation,
    );
  }

  const timeoutMs = clampSandboxTimeoutMs(params.timeoutMs);
  return runSandboxScriptInWorker({ ...params, timeoutMs });
}
