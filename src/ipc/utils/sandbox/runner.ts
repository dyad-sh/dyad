import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { SandboxHostCallObserver } from "./capabilities";
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
} from "./limits";
import {
  deserializeSandboxWorkerError,
  type SandboxWorkerInput,
  type SandboxWorkerMessage,
} from "./worker_protocol";

export { isSandboxSupportedPlatform };
export type { SandboxRunResult };

const WORKER_WALL_CLOCK_TIMEOUT_MARGIN_MS = 5_000;

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.VITEST_WORKER_ID !== undefined
  );
}

function resolveSandboxWorkerPath(): string | undefined {
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

function runSandboxScriptInWorker(params: {
  appPath: string;
  script: string;
  timeoutMs: number;
  persistFullOutput?: boolean;
  onHostCall?: SandboxHostCallObserver;
}): Promise<SandboxRunResult> {
  const workerPath = resolveSandboxWorkerPath();
  if (!workerPath) {
    return executeSandboxScriptInProcess(params);
  }

  const input: SandboxWorkerInput = {
    appPath: params.appPath,
    script: params.script,
    timeoutMs: params.timeoutMs,
    persistFullOutput: params.persistFullOutput,
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerPath, { workerData: input });
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

    function cleanup() {
      clearTimeout(wallClockTimeout);
      clearVmTimeout();
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
      settle(() => reject(error), true);
    });

    worker.on("exit", (code) => {
      settle(
        () =>
          reject(
            new DyadError(
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

export async function runSandboxScript(params: {
  appPath: string;
  script: string;
  timeoutMs?: number;
  persistFullOutput?: boolean;
  onHostCall?: SandboxHostCallObserver;
}): Promise<SandboxRunResult> {
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
