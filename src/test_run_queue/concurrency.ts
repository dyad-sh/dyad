import type { TestRunConcurrencyState, TestRunResourcePeak } from "./state";

export const TEST_RUN_RESOURCE_THRESHOLD_PERCENT = 90;

/**
 * Called once at settlement, counting the finishing run as still active.
 * Overload closes admission while this active group drains. Only its final
 * settlement reduces the limit, even if several runs saw the same overload.
 * Healthy runs retain additive growth until a group starts draining.
 */
export function settleTestRunConcurrency(
  current: TestRunConcurrencyState,
  activeCount: number,
  peak: TestRunResourcePeak | null,
): TestRunConcurrencyState {
  if (activeCount < 1) return current;
  const observed = peak
    ? accumulateTestRunResourcePeak(current.overloadedBatchPeak, peak)
    : current.overloadedBatchPeak;
  if (!observed) return current;
  const threshold = TEST_RUN_RESOURCE_THRESHOLD_PERCENT;
  if (
    (observed.cpuPercent !== null && observed.cpuPercent > threshold) ||
    (observed.memoryPercent !== null && observed.memoryPercent > threshold)
  ) {
    if (activeCount > 1) {
      if (
        current.overloadedBatchPeak?.cpuPercent === observed.cpuPercent &&
        current.overloadedBatchPeak?.memoryPercent === observed.memoryPercent
      )
        return current;
      return { ...current, overloadedBatchPeak: observed };
    }
    const limit = Math.max(1, current.limit - 1);
    return limit === current.limit && !current.overloadedBatchPeak
      ? current
      : { limit, overloadedBatchPeak: null };
  }
  if (
    activeCount === current.limit &&
    observed.cpuPercent !== null &&
    observed.memoryPercent !== null &&
    observed.cpuPercent < threshold &&
    observed.memoryPercent < threshold
  )
    return { ...current, limit: current.limit + 1 };
  // Equality, missing measurements, or unused capacity never grow the limit.
  return current;
}

export function accumulateTestRunResourcePeak(
  previous: TestRunResourcePeak | null,
  sample: TestRunResourcePeak,
): TestRunResourcePeak {
  return {
    cpuPercent: maximum(previous?.cpuPercent, sample.cpuPercent),
    memoryPercent: maximum(previous?.memoryPercent, sample.memoryPercent),
  };
}

function maximum(previous: number | null | undefined, sample: number | null) {
  if (sample === null) return previous ?? null;
  return Math.max(previous ?? 0, sample);
}
