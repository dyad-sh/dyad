import { expect, it } from "vitest";
import {
  accumulateTestRunResourcePeak,
  settleTestRunConcurrency,
} from "./concurrency";
import type { TestRunConcurrencyState } from "./state";

it.each([
  [1, 1, 89.9, 89.9, 2, false],
  [3, 3, 20, 40, 4, false],
  [3, 2, 20, 40, 3, false],
  [3, 4, 20, 40, 3, false],
  [3, 3, 90, 40, 3, false],
  [3, 3, 20, 90, 3, false],
  [3, 3, 90, 90, 3, false],
  [3, 3, 90.1, 40, 3, true],
  [3, 1, 20, 90.1, 2, false],
  [3, 3, 90, 95, 3, true],
  [1, 1, 100, 100, 1, false],
  [100, 100, 20, 40, 101, false],
  [3, 3, null, 40, 3, false],
  [3, 3, 20, null, 3, false],
  [3, 3, null, 95, 3, true],
  [3, 3, 95, null, 3, true],
] as const)(
  "settles C=%i with %i active and CPU=%s / memory=%s to %i (draining=%s)",
  (limit, active, cpuPercent, memoryPercent, expected, draining) => {
    const peak = { cpuPercent, memoryPercent };
    expect(
      settleTestRunConcurrency(
        { limit, overloadedBatchPeak: null },
        active,
        peak,
      ),
    ).toEqual({
      limit: expected,
      overloadedBatchPeak: draining ? peak : null,
    });
  },
);

it("holds without measurements", () => {
  const state = { limit: 3, overloadedBatchPeak: null };
  expect(settleTestRunConcurrency(state, 3, null)).toBe(state);
});

it("keeps the same state when overload cannot change the limit or pending peak", () => {
  const peak = { cpuPercent: 95, memoryPercent: 50 };
  const minimum = { limit: 1, overloadedBatchPeak: null };
  expect(settleTestRunConcurrency(minimum, 1, peak)).toBe(minimum);
  const draining = { limit: 3, overloadedBatchPeak: peak };
  expect(settleTestRunConcurrency(draining, 2, peak)).toBe(draining);
  expect(
    settleTestRunConcurrency(draining, 2, {
      cpuPercent: 20,
      memoryPercent: 40,
    }),
  ).toBe(draining);
});

it("reduces six overlapping overloaded runs from six to five only when the group ends", () => {
  let state: TestRunConcurrencyState = { limit: 6, overloadedBatchPeak: null };
  const peak = { cpuPercent: 100, memoryPercent: 85.28 };
  for (const active of [6, 5, 4, 3, 2]) {
    state = settleTestRunConcurrency(state, active, peak);
    expect(state).toEqual({ limit: 6, overloadedBatchPeak: peak });
  }
  state = settleTestRunConcurrency(state, 1, peak);
  expect(state).toEqual({ limit: 5, overloadedBatchPeak: null });
  expect(settleTestRunConcurrency(state, 0, peak)).toBe(state);
  // A fresh group can grow again after the previous group's overload cleared.
  expect(
    settleTestRunConcurrency(state, 5, { cpuPercent: 30, memoryPercent: 50 }),
  ).toEqual({ limit: 6, overloadedBatchPeak: null });
});

it("preserves overload across healthy and unmeasured completions, suppressing growth while draining", () => {
  let state: TestRunConcurrencyState = { limit: 3, overloadedBatchPeak: null };
  state = settleTestRunConcurrency(state, 3, {
    cpuPercent: 95,
    memoryPercent: 50,
  });
  state = settleTestRunConcurrency(state, 2, {
    cpuPercent: 20,
    memoryPercent: 60,
  });
  expect(state).toEqual({
    limit: 3,
    overloadedBatchPeak: { cpuPercent: 95, memoryPercent: 60 },
  });
  expect(settleTestRunConcurrency(state, 1, null)).toEqual({
    limit: 2,
    overloadedBatchPeak: null,
  });
});

it("retains independent CPU and memory peaks even after load falls or counters disappear", () => {
  let peak = accumulateTestRunResourcePeak(null, {
    cpuPercent: 94,
    memoryPercent: 20,
  });
  peak = accumulateTestRunResourcePeak(peak, {
    cpuPercent: 10,
    memoryPercent: 93,
  });
  peak = accumulateTestRunResourcePeak(peak, {
    cpuPercent: null,
    memoryPercent: 10,
  });
  expect(peak).toEqual({ cpuPercent: 94, memoryPercent: 93 });
  expect(
    settleTestRunConcurrency({ limit: 4, overloadedBatchPeak: null }, 4, peak),
  ).toEqual({ limit: 4, overloadedBatchPeak: peak });
});
