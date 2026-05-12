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
  persistFullOutput?: boolean;
  onHostCall?: SandboxHostCallObserver;
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
  const started = Date.now();
  const { Mustard, ExecutionContext } = await loadMustard();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const program = new Mustard(params.script);
    const context = new ExecutionContext({
      capabilities: buildSandboxCapabilitiesWithObserver(
        params.appPath,
        params.onHostCall,
      ) as unknown as Record<string, Capability>,
      limits: {
        instructionBudget: SANDBOX_INSTRUCTION_BUDGET,
        heapLimitBytes: SANDBOX_HEAP_LIMIT_BYTES,
        allocationBudget: SANDBOX_ALLOCATION_BUDGET,
        callDepthLimit: SANDBOX_CALL_DEPTH_LIMIT,
        maxOutstandingHostCalls: SANDBOX_MAX_OUTSTANDING_HOST_CALLS,
      },
      snapshotKey: `dyad-sandbox:${params.appPath}`,
    });

    const result = await program.run({
      context,
      signal: abortController.signal,
    });
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
      executionMs: Date.now() - started,
    };
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new DyadError(
        `Sandbox script timed out after ${timeoutMs}ms.`,
        DyadErrorKind.External,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
