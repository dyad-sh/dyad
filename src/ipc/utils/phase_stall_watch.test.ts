import { afterEach, expect, it, vi } from "vitest";

import { startPhaseStallWatch } from "./phase_stall_watch";

afterEach(() => {
  vi.useRealTimers();
});

it("logs transitions and elapsed time immediately, and stops only once", async () => {
  vi.useFakeTimers();
  const info = vi.fn();
  const watch = startPhaseStallWatch({
    label: "Preparation",
    initialPhase: "setup",
    warn: vi.fn(),
    info,
  });
  expect(info).toHaveBeenLastCalledWith('Preparation started phase "setup"');
  await vi.advanceTimersByTimeAsync(125);
  watch.setPhase("copying overlay files");
  expect(info.mock.calls.map(([message]) => message)).toEqual([
    'Preparation started phase "setup"',
    'Preparation finished phase "setup" after 125 ms',
    'Preparation started phase "copying overlay files"',
  ]);
  await vi.advanceTimersByTimeAsync(250);
  watch.stop();
  expect(info).toHaveBeenLastCalledWith(
    'Preparation finished phase "copying overlay files" after 250 ms',
  );
  watch.stop();
  watch.setPhase("ignored");
  expect(info).toHaveBeenCalledTimes(4);
});

it("names the stuck phase with backoff and summarizes phase durations", async () => {
  vi.useFakeTimers();
  const warn = vi.fn();
  const watch = startPhaseStallWatch({
    label: "Preparation",
    initialPhase: "setup",
    warn,
    firstWarningMs: 1_000,
  });
  await vi.advanceTimersByTimeAsync(500);
  watch.setPhase("worktree creation");
  await vi.advanceTimersByTimeAsync(2_500);
  expect(warn.mock.calls.map(([message]) => message)).toEqual([
    'Preparation still running after 1s; in "worktree creation" for 1s',
    'Preparation still running after 3s; in "worktree creation" for 3s',
  ]);
  expect(watch.currentPhase()).toBe("worktree creation");
  expect(watch.stop()).toBe("setup: 500 ms; worktree creation: 2500 ms");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(warn).toHaveBeenCalledTimes(2);
  expect(watch.stop()).toBe("setup: 500 ms; worktree creation: 2500 ms");
});
