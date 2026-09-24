import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock electron-log so retryOnLocked's `log.scope("retryOnLocked")` and the
// logger.info/warn/error calls don't touch the disk or Electron APIs.
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { retryOnLocked } from "@/ipc/utils/retryOnLocked";

describe("retryOnLocked", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Make backoff delays deterministic (jitter uses Math.random()).
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the result on the first successful attempt", async () => {
    const operation = vi.fn().mockResolvedValue("success");

    const result = await retryOnLocked(operation, "test-operation");

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a 423 (locked) error and succeeds on the next attempt", async () => {
    const lockedError = { response: { status: 423 } };
    const operation = vi
      .fn()
      .mockRejectedValueOnce(lockedError)
      .mockResolvedValueOnce("success after retry");

    const resultPromise = retryOnLocked(operation, "test-operation");

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;

    expect(result).toBe("success after retry");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("throws immediately for a 422 'branch has a child' error without scheduling any retry", async () => {
    // This is the precondition reported by deleteProjectBranch when the
    // preserve branch has a child. It is permanent (Neon offers no reparent
    // API) and MUST NOT be retried — previously it spun for ~63s of
    // guaranteed-fail backoff via the `retryBranchWithChildError` option.
    const branchChildError = { response: { status: 422 } };
    const operation = vi.fn().mockRejectedValue(branchChildError);

    await expect(
      retryOnLocked(operation, "delete-preserve-branch"),
    ).rejects.toEqual(branchChildError);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("throws immediately for a non-retryable 400 error", async () => {
    // Guards against accidentally broadening `isRetryableError` to non-423/429
    // statuses; the 422 case above is the specific instance of this principle.
    const badRequestError = { response: { status: 400 } };
    const operation = vi.fn().mockRejectedValue(badRequestError);

    await expect(retryOnLocked(operation, "test-operation")).rejects.toEqual(
      badRequestError,
    );

    expect(operation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts immediately when a 422 appears after a retryed 423 (does not swallow into the retry loop)", async () => {
    const lockedError = { response: { status: 423 } };
    const branchChildError = { response: { status: 422 } };
    const operation = vi
      .fn()
      .mockRejectedValueOnce(lockedError)
      .mockRejectedValueOnce(branchChildError);

    const resultPromise = retryOnLocked(operation, "test-operation");

    // Attach rejection handler BEFORE flushing timers to avoid an
    // unhandled rejection once the 422 aborts the retry loop.
    const expectation = expect(resultPromise).rejects.toEqual(branchChildError);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    await expectation;
    expect(operation).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("exhausts retries (1 initial + 6) on a persistent 423 before rejecting", async () => {
    const lockedError = { response: { status: 423 } };
    const operation = vi.fn().mockRejectedValue(lockedError);

    const resultPromise = retryOnLocked(operation, "test-operation");

    // Attach rejection handler BEFORE flushing timers to avoid an
    // unhandled rejection.
    const expectation = expect(resultPromise).rejects.toEqual(lockedError);

    await vi.runAllTimersAsync();

    await expectation;
    expect(operation).toHaveBeenCalledTimes(7);
  });

  it("does not resurrect 422 retries when the removed option is passed at runtime (regression guard)", async () => {
    // The `retryBranchWithChildError` option has been removed from the
    // signature; a stale caller passing it at runtime must not re-enable the
    // old swallowed-and-retried 422 behavior — a permanent 422 still aborts
    // after a single attempt with no backoff.
    const branchChildError = { response: { status: 422 } };
    const operation = vi.fn().mockRejectedValue(branchChildError);

    const retryOnLockedWithRemovedOption = retryOnLocked as unknown as (
      op: () => Promise<unknown>,
      ctx: string,
      opts: { retryBranchWithChildError?: boolean },
    ) => Promise<unknown>;
    const deletePromise = retryOnLockedWithRemovedOption(
      operation,
      "delete-preserve-branch",
      { retryBranchWithChildError: true },
    );

    await expect(deletePromise).rejects.toEqual(branchChildError);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
