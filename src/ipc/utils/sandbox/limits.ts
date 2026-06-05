export const SANDBOX_SCRIPT_SOURCE_LIMIT_BYTES = 128 * 1024;
export const SANDBOX_LLM_OUTPUT_LIMIT_BYTES = 256 * 1024;
export const SANDBOX_UI_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;
export const SANDBOX_READ_FILE_LIMIT_BYTES = 20 * 1024 * 1024;

export const DEFAULT_SANDBOX_TIMEOUT_MS = 60_000;
export const MAX_SANDBOX_TIMEOUT_MS = 60_000;
export const SANDBOX_WALL_CLOCK_TIMEOUT_MS = 5 * 60_000;

// Avoid running out of instructions (e.g. parsing large CSV file)
// Note: we have a sandbox timeout and run it off main thread, so
// this is not too problematic.
export const SANDBOX_INSTRUCTION_BUDGET = Number.MAX_SAFE_INTEGER;
export const SANDBOX_HEAP_LIMIT_BYTES = 128 * 1024 * 1024;
export const SANDBOX_ALLOCATION_BUDGET = 1_000_000;
export const SANDBOX_CALL_DEPTH_LIMIT = 512;
export const SANDBOX_MAX_OUTSTANDING_HOST_CALLS = 32;

export function clampSandboxTimeoutMs(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_SANDBOX_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(Math.floor(timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS), 1),
    MAX_SANDBOX_TIMEOUT_MS,
  );
}

export function clampSandboxWallClockTimeoutMs(
  timeoutMs: number | undefined,
): number {
  if (!Number.isFinite(timeoutMs)) {
    return SANDBOX_WALL_CLOCK_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(Math.floor(timeoutMs ?? SANDBOX_WALL_CLOCK_TIMEOUT_MS), 1),
    SANDBOX_WALL_CLOCK_TIMEOUT_MS,
  );
}
