export const SANDBOX_SCRIPT_SOURCE_LIMIT_BYTES = 32 * 1024;
export const SANDBOX_LLM_OUTPUT_LIMIT_BYTES = 64 * 1024;
export const SANDBOX_UI_OUTPUT_LIMIT_BYTES = 1024 * 1024;
export const SANDBOX_READ_FILE_LIMIT_BYTES = 1024 * 1024;

export const DEFAULT_SANDBOX_TIMEOUT_MS = DEFAULT_SANDBOX_SCRIPT_TIMEOUT_MS;
export const MAX_SANDBOX_TIMEOUT_MS = MAX_SANDBOX_SCRIPT_TIMEOUT_MS;
export const SANDBOX_HOST_CALL_TIMEOUT_MS = 500;

export const SANDBOX_INSTRUCTION_BUDGET = 1_000_000;
export const SANDBOX_HEAP_LIMIT_BYTES = 16 * 1024 * 1024;
export const SANDBOX_ALLOCATION_BUDGET = 100_000;
export const SANDBOX_CALL_DEPTH_LIMIT = 256;
export const SANDBOX_MAX_OUTSTANDING_HOST_CALLS = 16;

export function clampSandboxTimeoutMs(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_SANDBOX_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(Math.floor(timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS), 1),
    MAX_SANDBOX_TIMEOUT_MS,
  );
}
import {
  DEFAULT_SANDBOX_SCRIPT_TIMEOUT_MS,
  MAX_SANDBOX_SCRIPT_TIMEOUT_MS,
} from "@/constants/settings_constants";
