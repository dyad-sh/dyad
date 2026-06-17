import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Capability, StructuredValue } from "mustardscript";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadMediaDir } from "@/ipc/utils/media_path_utils";
import {
  buildSandboxCapabilitiesWithObserver,
  type SandboxHostCallObserver,
} from "./capabilities";
import {
  clampSandboxWallClockTimeoutMs,
  clampSandboxTimeoutMs,
  SANDBOX_ALLOCATION_BUDGET,
  SANDBOX_CALL_DEPTH_LIMIT,
  SANDBOX_HEAP_LIMIT_BYTES,
  SANDBOX_INSTRUCTION_BUDGET,
  SANDBOX_LLM_OUTPUT_LIMIT_BYTES,
  SANDBOX_MAX_OUTSTANDING_HOST_CALLS,
  SANDBOX_SCRIPT_SOURCE_LIMIT_BYTES,
  SANDBOX_UI_OUTPUT_LIMIT_BYTES,
} from "./limits";

type MustardModule = typeof import("mustardscript");

let mustardModulePromise: Promise<MustardModule> | null = null;

export interface SandboxRunResult {
  value: string;
  truncated: boolean;
  fullOutputPath?: string;
  executionMs: number;
  instructionsUsed?: number;
  heapBytesUsed?: number;
}

export interface SandboxExecutionParams {
  appPath: string;
  script: string;
  timeoutMs?: number;
  wallClockTimeoutMs?: number;
  persistFullOutput?: boolean;
  onHostCall?: SandboxHostCallObserver;
  onVmBudgetStart?: () => void;
  onVmBudgetPause?: () => void;
  onVmBudgetResume?: () => void;
  capabilities?: Record<string, (...args: unknown[]) => unknown>;
}

export function isSandboxSupportedPlatform(): boolean {
  if (process.platform === "darwin") {
    return process.arch === "arm64" || process.arch === "x64";
  }
  if (process.platform === "linux") {
    return process.arch === "x64";
  }
  if (process.platform === "win32") {
    return process.arch === "x64";
  }
  return false;
}

async function loadMustard(): Promise<MustardModule> {
  if (!isSandboxSupportedPlatform()) {
    throw new DyadError(
      "Sandbox scripting is unavailable on this platform.",
      DyadErrorKind.Precondition,
    );
  }
  mustardModulePromise ??= import("mustardscript").catch((error) => {
    mustardModulePromise = null;
    throw error;
  });
  return mustardModulePromise;
}

function stringifyStructuredValue(value: StructuredValue): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value, null, 2);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) {
    return value;
  }
  let end = maxBytes;
  let charStart = end - 1;
  while (charStart > 0 && (bytes[charStart] & 0xc0) === 0x80) {
    charStart--;
  }

  const lead = bytes[charStart];
  const expectedLength =
    lead < 0x80
      ? 1
      : (lead & 0xe0) === 0xc0
        ? 2
        : (lead & 0xf0) === 0xe0
          ? 3
          : (lead & 0xf8) === 0xf0
            ? 4
            : 1;
  if (charStart + expectedLength > end) {
    end = charStart;
  }

  return bytes.subarray(0, end).toString("utf8");
}

async function spillOutput(params: {
  appPath: string;
  output: string;
}): Promise<string> {
  const hash = crypto
    .createHash("sha256")
    .update(params.output)
    .digest("hex")
    .slice(0, 16);
  const capped = truncateUtf8(params.output, SANDBOX_UI_OUTPUT_LIMIT_BYTES);
  const outputPath = path.join(
    getDyadMediaDir(params.appPath),
    `script-output-${hash}.txt`,
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, capped, "utf8");
  return outputPath;
}

function createVmRuntimeBudget(timeoutMs: number): {
  signal: AbortSignal;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  abort: () => void;
  getElapsedMs: () => number;
} {
  const abortController = new AbortController();
  let elapsedMs = 0;
  let runningSince: number | undefined;
  let timer: NodeJS.Timeout | undefined;
  let pauseDepth = 0;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function abortIfExpired() {
    if (elapsedMs >= timeoutMs && !abortController.signal.aborted) {
      abortController.abort();
    }
  }

  function scheduleTimer() {
    clearTimer();
    if (abortController.signal.aborted || pauseDepth > 0) {
      return;
    }
    const remainingMs = timeoutMs - elapsedMs;
    if (remainingMs <= 0) {
      abortIfExpired();
      return;
    }
    timer = setTimeout(() => {
      if (runningSince !== undefined) {
        elapsedMs += Date.now() - runningSince;
        runningSince = Date.now();
      }
      abortIfExpired();
      if (!abortController.signal.aborted) {
        scheduleTimer();
      }
    }, remainingMs);
  }

  function start() {
    if (runningSince === undefined && !abortController.signal.aborted) {
      runningSince = Date.now();
      scheduleTimer();
    }
  }

  function pause() {
    if (runningSince !== undefined) {
      elapsedMs += Date.now() - runningSince;
      runningSince = undefined;
    }
    pauseDepth += 1;
    clearTimer();
    abortIfExpired();
  }

  function resume() {
    if (pauseDepth === 0) {
      return;
    }
    pauseDepth -= 1;
    if (pauseDepth > 0 || abortController.signal.aborted) {
      return;
    }
    runningSince = Date.now();
    scheduleTimer();
  }

  function stop() {
    if (runningSince !== undefined) {
      elapsedMs += Date.now() - runningSince;
      runningSince = undefined;
    }
    clearTimer();
  }

  return {
    signal: abortController.signal,
    start,
    pause,
    resume,
    stop,
    abort: () => abortController.abort(),
    getElapsedMs: () =>
      runningSince === undefined
        ? elapsedMs
        : elapsedMs + Date.now() - runningSince,
  };
}

function wrapCapabilitiesWithVmBudget(
  capabilities: Record<string, (...args: unknown[]) => unknown>,
  budget: Pick<
    ReturnType<typeof createVmRuntimeBudget>,
    "pause" | "resume" | "signal"
  >,
  hooks: Pick<SandboxExecutionParams, "onVmBudgetPause" | "onVmBudgetResume">,
): Record<string, (...args: unknown[]) => unknown> {
  return Object.fromEntries(
    Object.entries(capabilities).map(([name, capability]) => [
      name,
      (...args: unknown[]) => {
        budget.pause();
        hooks.onVmBudgetPause?.();
        if (budget.signal.aborted) {
          hooks.onVmBudgetResume?.();
          budget.resume();
          throw new DyadError(
            "Sandbox script timed out before host call execution.",
            DyadErrorKind.External,
          );
        }
        try {
          const result = capability(...args);
          if (
            result !== null &&
            typeof result === "object" &&
            "then" in result &&
            typeof result.then === "function"
          ) {
            return Promise.resolve(result).finally(() => {
              hooks.onVmBudgetResume?.();
              budget.resume();
            });
          }
          hooks.onVmBudgetResume?.();
          budget.resume();
          return result;
        } catch (error) {
          hooks.onVmBudgetResume?.();
          budget.resume();
          throw error;
        }
      },
    ]),
  );
}

export async function executeSandboxScriptInProcess(
  params: SandboxExecutionParams,
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
  const wallClockTimeoutMs = clampSandboxWallClockTimeoutMs(
    params.wallClockTimeoutMs,
  );
  const { Mustard, ExecutionContext } = await loadMustard();
  const vmBudget = createVmRuntimeBudget(timeoutMs);
  let wallClockTimeout: NodeJS.Timeout | undefined;
  let wallClockTimeoutError: DyadError | undefined;

  try {
    const program = new Mustard(params.script);
    const rawCapabilityMap =
      params.capabilities ??
      buildSandboxCapabilitiesWithObserver(params.appPath, params.onHostCall);
    const capabilityMap = wrapCapabilitiesWithVmBudget(
      rawCapabilityMap,
      vmBudget,
      params,
    );
    const context = new ExecutionContext({
      capabilities: capabilityMap as unknown as Record<string, Capability>,
      limits: {
        instructionBudget: SANDBOX_INSTRUCTION_BUDGET,
        heapLimitBytes: SANDBOX_HEAP_LIMIT_BYTES,
        allocationBudget: SANDBOX_ALLOCATION_BUDGET,
        callDepthLimit: SANDBOX_CALL_DEPTH_LIMIT,
        maxOutstandingHostCalls: SANDBOX_MAX_OUTSTANDING_HOST_CALLS,
      },
      snapshotKey: `dyad-sandbox:${params.appPath}`,
    });

    vmBudget.start();
    params.onVmBudgetStart?.();
    const result = await Promise.race([
      program.run({
        context,
        signal: vmBudget.signal,
      }),
      new Promise<never>((_, reject) => {
        wallClockTimeout = setTimeout(() => {
          wallClockTimeoutError = new DyadError(
            `Sandbox host execution timed out after ${wallClockTimeoutMs}ms.`,
            DyadErrorKind.External,
          );
          vmBudget.abort();
          reject(wallClockTimeoutError);
        }, wallClockTimeoutMs);
      }),
    ]);
    if (wallClockTimeout) {
      clearTimeout(wallClockTimeout);
      wallClockTimeout = undefined;
    }
    vmBudget.stop();
    const executionMs = vmBudget.getElapsedMs();
    const output = stringifyStructuredValue(result);
    const truncated =
      Buffer.byteLength(output, "utf8") > SANDBOX_LLM_OUTPUT_LIMIT_BYTES;
    const fullOutputPath =
      truncated && params.persistFullOutput !== false
        ? await spillOutput({ appPath: params.appPath, output })
        : undefined;

    return {
      value: truncated
        ? truncateUtf8(output, SANDBOX_LLM_OUTPUT_LIMIT_BYTES)
        : output,
      truncated,
      fullOutputPath,
      executionMs,
    };
  } catch (error) {
    vmBudget.stop();
    if (wallClockTimeoutError) {
      throw error === wallClockTimeoutError ? error : wallClockTimeoutError;
    }
    if (vmBudget.signal.aborted) {
      throw new DyadError(
        `Sandbox script timed out after ${timeoutMs}ms of VM execution.`,
        DyadErrorKind.External,
      );
    }
    throw error;
  } finally {
    if (wallClockTimeout) {
      clearTimeout(wallClockTimeout);
    }
  }
}
