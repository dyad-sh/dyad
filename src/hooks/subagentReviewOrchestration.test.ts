import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runAutoReviewBarrier: vi.fn(),
  skipReviewAutoFix: vi.fn(),
  dispatchQueueEvent: vi.fn(),
  queue: [{ itemId: "queued-1" }] as Array<{ itemId: string }>,
  streamFinishedCallback: undefined as
    | ((event: {
        chatId: number;
        outcome: "completed" | "cancelled" | "errored";
        updatedFiles: boolean;
        reviewBarrierRequested: boolean;
        suppressAutoReview?: boolean;
        wasCancelled: boolean;
      }) => void)
    | undefined,
}));

vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useChatStreamManager: () => ({
    dispatchQueueEvent: mocks.dispatchQueueEvent,
    ensure: () => ({
      getSnapshot: () => ({
        phase: "idle",
        queuePaused: true,
        queue: mocks.queue,
        lastCompletion: { pausePromptQueue: true },
      }),
      send: vi.fn(),
    }),
  }),
  useStreamFinished: (
    callback: NonNullable<typeof mocks.streamFinishedCallback>,
  ) => {
    mocks.streamFinishedCallback = callback;
  },
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings: {
      enableAutoReview: true,
      autoFixReviewIssues: false,
      enableDyadPro: true,
    },
  }),
}));

vi.mock("@/ipc/types", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ipc/types")>();
  return {
    ...original,
    ipc: {
      ...original.ipc,
      agent: {
        ...original.ipc.agent,
        ...mocks,
      },
    },
  };
});

import {
  runBackgroundAutoReview,
  shouldResumePendingReview,
  shouldStartBackgroundAutoReview,
  useBackgroundAutoReview,
} from "./subagentReviewOrchestration";
import {
  hasPendingReviewContinuation,
  resumePendingReviewContinuation,
  setPendingReviewContinuation,
} from "./subagentReviewContinuation";

describe("sub-agent review orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queue = [{ itemId: "queued-1" }];
    mocks.streamFinishedCallback = undefined;
    mocks.dispatchQueueEvent.mockResolvedValue(undefined);
  });

  it("leaves queued-message barrier ownership in the main actor", async () => {
    renderHook(() => useBackgroundAutoReview());

    mocks.streamFinishedCallback?.({
      chatId: 7,
      outcome: "completed",
      updatedFiles: true,
      reviewBarrierRequested: true,
      wasCancelled: false,
    });

    await Promise.resolve();
    expect(mocks.runAutoReviewBarrier).not.toHaveBeenCalled();
    expect(mocks.dispatchQueueEvent).not.toHaveBeenCalled();
  });

  it("does not let a renderer release a main-owned queued barrier", async () => {
    renderHook(() => useBackgroundAutoReview());

    mocks.streamFinishedCallback?.({
      chatId: 7,
      outcome: "completed",
      updatedFiles: true,
      reviewBarrierRequested: true,
      wasCancelled: false,
    });

    await Promise.resolve();
    expect(mocks.runAutoReviewBarrier).not.toHaveBeenCalled();
    expect(mocks.dispatchQueueEvent).not.toHaveBeenCalled();
  });

  it("leaves an unqueued review barrier in the main actor", async () => {
    mocks.queue = [];
    renderHook(() => useBackgroundAutoReview());

    mocks.streamFinishedCallback?.({
      chatId: 7,
      outcome: "completed",
      updatedFiles: true,
      reviewBarrierRequested: true,
      wasCancelled: false,
    });

    await Promise.resolve();
    expect(mocks.runAutoReviewBarrier).not.toHaveBeenCalled();
  });

  it("does not start renderer auto-review when main suppresses it", async () => {
    mocks.queue = [];
    renderHook(() => useBackgroundAutoReview());

    mocks.streamFinishedCallback?.({
      chatId: 7,
      outcome: "completed",
      updatedFiles: true,
      reviewBarrierRequested: false,
      suppressAutoReview: true,
      wasCancelled: false,
    });

    await Promise.resolve();
    expect(mocks.runAutoReviewBarrier).not.toHaveBeenCalled();
  });

  it("does not resume a paused queue when a suppressed turn is cancelled", async () => {
    renderHook(() => useBackgroundAutoReview());

    mocks.streamFinishedCallback?.({
      chatId: 7,
      outcome: "cancelled",
      updatedFiles: false,
      reviewBarrierRequested: false,
      suppressAutoReview: true,
      wasCancelled: true,
    });

    await Promise.resolve();
    expect(mocks.dispatchQueueEvent).not.toHaveBeenCalled();
  });

  it("leaves queued turns to the queue review barrier", () => {
    expect(
      shouldStartBackgroundAutoReview({
        updatedFiles: true,
        enableAutoReview: true,
        hasQueuedMessages: true,
        suppressAutoReview: false,
      }),
    ).toBe(false);
  });

  it("does not resume a paused review continuation after cancellation", () => {
    expect(
      shouldResumePendingReview({
        wasCancelled: true,
        pausePromptQueue: false,
        hasPendingContinuation: true,
      }),
    ).toBe(false);
    expect(
      shouldResumePendingReview({
        wasCancelled: false,
        pausePromptQueue: false,
        hasPendingContinuation: true,
      }),
    ).toBe(true);
  });

  it("does not recursively review remediation turns", () => {
    expect(
      shouldStartBackgroundAutoReview({
        updatedFiles: true,
        enableAutoReview: true,
        hasQueuedMessages: false,
        suppressAutoReview: true,
      }),
    ).toBe(false);
  });

  it("resumes a paused remediation with exactly one verification", async () => {
    const verify = vi.fn(async () => {});
    setPendingReviewContinuation(8, verify);

    expect(hasPendingReviewContinuation(8)).toBe(true);
    await expect(resumePendingReviewContinuation(8)).resolves.toBe(true);
    await expect(resumePendingReviewContinuation(8)).resolves.toBe(false);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(hasPendingReviewContinuation(8)).toBe(false);
  });

  it("auto-fixes a background review only when enabled, then verifies", async () => {
    mocks.runAutoReviewBarrier
      .mockResolvedValueOnce({ outcome: "released" })
      .mockResolvedValueOnce({
        outcome: "fix_required",
        threadId: "review-1",
        prompt: "fix it",
      })
      .mockResolvedValueOnce({ outcome: "released" });
    const streamFix = vi.fn(async () => "completed" as const);

    await runBackgroundAutoReview({
      chatId: 7,
      getAutoFix: () => true,
      streamFix,
    });

    expect(mocks.runAutoReviewBarrier).toHaveBeenNthCalledWith(1, {
      chatId: 7,
      autoFix: false,
    });
    expect(mocks.runAutoReviewBarrier).toHaveBeenNthCalledWith(2, {
      chatId: 7,
      autoFix: true,
    });
    expect(streamFix).toHaveBeenCalledWith("fix it");
    expect(mocks.runAutoReviewBarrier).toHaveBeenCalledWith({
      chatId: 7,
      verification: true,
    });
  });

  it("verifies after a step-limited background remediation resumes", async () => {
    mocks.runAutoReviewBarrier
      .mockResolvedValueOnce({ outcome: "released" })
      .mockResolvedValueOnce({
        outcome: "fix_required",
        threadId: "review-1",
        prompt: "fix it",
      });

    await runBackgroundAutoReview({
      chatId: 12,
      getAutoFix: () => true,
      streamFix: async () => "paused",
    });

    expect(mocks.runAutoReviewBarrier).toHaveBeenCalledTimes(2);
    expect(hasPendingReviewContinuation(12)).toBe(true);

    await expect(resumePendingReviewContinuation(12)).resolves.toBe(true);
    expect(mocks.runAutoReviewBarrier).toHaveBeenCalledWith({
      chatId: 12,
      verification: true,
    });
    await expect(resumePendingReviewContinuation(12)).resolves.toBe(false);
  });

  it("reports a background review without fixing when auto-fix is disabled", async () => {
    mocks.runAutoReviewBarrier.mockResolvedValue({ outcome: "released" });

    await runBackgroundAutoReview({
      chatId: 7,
      getAutoFix: () => false,
      streamFix: vi.fn(),
    });

    expect(mocks.runAutoReviewBarrier).toHaveBeenCalledWith({
      chatId: 7,
      autoFix: false,
    });
  });

  it("reads the latest auto-fix setting after Reviewer completes", async () => {
    let finishReview!: (value: { outcome: "released" }) => void;
    let autoFix = true;
    mocks.runAutoReviewBarrier.mockReturnValue(
      new Promise((resolve) => {
        finishReview = resolve;
      }),
    );

    const run = runBackgroundAutoReview({
      chatId: 10,
      getAutoFix: () => autoFix,
      streamFix: vi.fn(),
    });
    await vi.waitFor(() =>
      expect(mocks.runAutoReviewBarrier).toHaveBeenCalled(),
    );
    autoFix = false;
    finishReview({ outcome: "released" });
    await run;

    expect(mocks.runAutoReviewBarrier).toHaveBeenCalledWith({
      chatId: 10,
      autoFix: false,
    });
    expect(mocks.runAutoReviewBarrier).toHaveBeenCalledTimes(1);
  });

  it("replays the newest background auto-review requested while one is active", async () => {
    let resolveFirstReview!: (value: { outcome: "released" }) => void;
    const firstReview = new Promise<{ outcome: "released" }>((resolve) => {
      resolveFirstReview = resolve;
    });
    mocks.runAutoReviewBarrier
      .mockReturnValueOnce(firstReview)
      .mockResolvedValueOnce({ outcome: "released" });

    const firstRun = runBackgroundAutoReview({
      chatId: 9,
      getAutoFix: () => false,
      streamFix: vi.fn(),
    });
    await vi.waitFor(() => {
      expect(mocks.runAutoReviewBarrier).toHaveBeenCalledTimes(1);
    });

    await runBackgroundAutoReview({
      chatId: 9,
      getAutoFix: () => false,
      streamFix: vi.fn(),
    });
    resolveFirstReview({ outcome: "released" });
    await firstRun;

    expect(mocks.runAutoReviewBarrier).toHaveBeenCalledTimes(2);
    expect(mocks.runAutoReviewBarrier).toHaveBeenNthCalledWith(1, {
      chatId: 9,
      autoFix: false,
    });
    expect(mocks.runAutoReviewBarrier).toHaveBeenNthCalledWith(2, {
      chatId: 9,
      autoFix: false,
    });
  });
});
