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
  clampSandboxTimeoutMs,
  SANDBOX_SCRIPT_SOURCE_LIMIT_BYTES,
} from "./limits";
import {
  deserializeSandboxWorkerError,
  type SandboxWorkerInput,
  type SandboxWorkerMessage,
} from "./worker_protocol";

export { isSandboxSupportedPlatform };
export type { SandboxRunResult };

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
    const timeout = setTimeout(() => {
      settle(
        () =>
          reject(
            new DyadError(
              `Sandbox script timed out after ${params.timeoutMs}ms.`,
              DyadErrorKind.External,
            ),
          ),
        true,
      );
    }, params.timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
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
