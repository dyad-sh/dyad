import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "jotai";
import type { SubagentThreadSummary } from "@/ipc/types/agent";
import {
  effectiveQueuePausedByIdAtom,
  queuePausedByIdAtom,
  reviewBarrierHeldByIdAtom,
} from "@/atoms/chatAtoms";

const mocks = vi.hoisted(() => ({
  startAutoReview: vi.fn(),
  listSubagents: vi.fn(),
  fixReviewFindings: vi.fn(),
  runAutoReviewBarrier: vi.fn(),
  skipReviewAutoFix: vi.fn(),
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
  isStreamReviewEligible,
  runBackgroundAutoReview,
  shouldStartBackgroundAutoReview,
} from "./useStreamChat";
import {
  runQueuedReviewFlow,
  shouldRunQueuedReviewBarrier,
} from "./useQueueProcessor";
import {
  hasPendingReviewContinuation,
  resumePendingReviewContinuation,
  setPendingReviewContinuation,
} from "./subagentReviewContinuation";

function review(
  overrides: Partial<SubagentThreadSummary> = {},
): SubagentThreadSummary {
  return {
    id: "review-1",
    chatId: 7,
    persona: "reviewer",
    taskName: "review",
    assignment: "review",
    status: "completed",
    provider: "openai",
    model: "reviewer",
    reasoningEffort: "medium",
    result: { findingCount: 1 },
    reviewBaseCommit: null,
    reviewTargetCommit: null,
    reviewDiffHash: "hash",
    sourceMessageId: 42,
    invocationSource: "auto_review",
    autoFixAt: null,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
    toolCallCount: 0,
    createdAt: new Date(),
    startedAt: new Date(),
    completedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("sub-agent review orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("bypasses the queued review barrier when the completed turn changed no files", () => {
    expect(
      isStreamReviewEligible({ updatedFiles: false, wasCancelled: false }),
    ).toBe(false);
    expect(
      isStreamReviewEligible({ updatedFiles: true, wasCancelled: true }),
    ).toBe(false);
    expect(
      isStreamReviewEligible({ updatedFiles: true, wasCancelled: false }),
    ).toBe(true);
    expect(shouldRunQueuedReviewBarrier(false)).toBe(false);
    expect(shouldRunQueuedReviewBarrier(true)).toBe(true);
  });

  it("preserves an explicit user pause when the review barrier releases its hold", () => {
    const store = createStore();
    store.set(queuePausedByIdAtom, new Map([[7, true]]));
    store.set(reviewBarrierHeldByIdAtom, new Map([[7, true]]));

    store.set(reviewBarrierHeldByIdAtom, new Map([[7, false]]));

    expect(store.get(queuePausedByIdAtom).get(7)).toBe(true);
    expect(store.get(effectiveQueuePausedByIdAtom).get(7)).toBe(true);
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

  it("remediates and verifies before releasing a queued message", async () => {
    const events: string[] = [];
    const runBarrier = vi.fn(async (verification?: boolean) => {
      events.push(verification ? "verify" : "review");
      return verification
        ? ({ outcome: "released" } as const)
        : ({ outcome: "fix_required", prompt: "fix it" } as const);
    });
    const streamRemediation = vi.fn(async () => {
      events.push("fix");
      return "completed" as const;
    });

    await expect(
      runQueuedReviewFlow({ runBarrier, streamRemediation }),
    ).resolves.toBe("released");
    expect(events).toEqual(["review", "fix", "verify"]);
  });

  it("releases the queued message when remediation fails", async () => {
    const runBarrier = vi.fn(async () => ({
      outcome: "fix_required" as const,
      threadId: "review-1",
      prompt: "fix it",
    }));
    const onRemediationFailed = vi.fn(async () => {});

    await expect(
      runQueuedReviewFlow({
        runBarrier,
        streamRemediation: async () => "failed",
        onRemediationFailed,
      }),
    ).resolves.toBe("released");
    expect(runBarrier).toHaveBeenCalledTimes(1);
    expect(onRemediationFailed).toHaveBeenCalledWith("review-1");
  });

  it("keeps the queue paused when remediation hits the step limit", async () => {
    const runBarrier = vi.fn(async () => ({
      outcome: "fix_required" as const,
      threadId: "review-1",
      prompt: "fix it",
    }));
    const onRemediationFailed = vi.fn(async () => {});
    const onRemediationPaused = vi.fn();

    await expect(
      runQueuedReviewFlow({
        runBarrier,
        streamRemediation: async () => "paused",
        onRemediationFailed,
        onRemediationPaused,
      }),
    ).resolves.toBe("paused");
    expect(runBarrier).toHaveBeenCalledTimes(1);
    expect(onRemediationFailed).not.toHaveBeenCalled();
    expect(onRemediationPaused).toHaveBeenCalledTimes(1);
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
    mocks.startAutoReview.mockResolvedValue(review());
    mocks.fixReviewFindings.mockResolvedValue({ prompt: "fix it" });
    mocks.runAutoReviewBarrier.mockResolvedValue({ outcome: "released" });
    const streamFix = vi.fn(async () => "completed" as const);

    await runBackgroundAutoReview({
      chatId: 7,
      sourceMessageId: 42,
      getAutoFix: () => true,
      streamFix,
    });

    expect(streamFix).toHaveBeenCalledWith("fix it");
    expect(mocks.runAutoReviewBarrier).toHaveBeenCalledWith({
      chatId: 7,
      verification: true,
    });
  });

  it("verifies after a step-limited background remediation resumes", async () => {
    mocks.startAutoReview.mockResolvedValue(review());
    mocks.fixReviewFindings.mockResolvedValue({ prompt: "fix it" });

    await runBackgroundAutoReview({
      chatId: 12,
      sourceMessageId: 42,
      getAutoFix: () => true,
      streamFix: async () => "paused",
    });

    expect(mocks.runAutoReviewBarrier).not.toHaveBeenCalled();
    expect(hasPendingReviewContinuation(12)).toBe(true);

    await expect(resumePendingReviewContinuation(12)).resolves.toBe(true);
    expect(mocks.runAutoReviewBarrier).toHaveBeenCalledWith({
      chatId: 12,
      verification: true,
    });
    await expect(resumePendingReviewContinuation(12)).resolves.toBe(false);
  });

  it("reports a background review without fixing when auto-fix is disabled", async () => {
    mocks.startAutoReview.mockResolvedValue(review());

    await runBackgroundAutoReview({
      chatId: 7,
      sourceMessageId: 42,
      getAutoFix: () => false,
      streamFix: vi.fn(),
    });

    expect(mocks.fixReviewFindings).not.toHaveBeenCalled();
    expect(mocks.runAutoReviewBarrier).not.toHaveBeenCalled();
  });

  it("reads the latest auto-fix setting after Reviewer completes", async () => {
    let finishReview!: (value: SubagentThreadSummary) => void;
    let autoFix = true;
    mocks.startAutoReview.mockReturnValue(
      new Promise<SubagentThreadSummary>((resolve) => {
        finishReview = resolve;
      }),
    );

    const run = runBackgroundAutoReview({
      chatId: 10,
      sourceMessageId: 42,
      getAutoFix: () => autoFix,
      streamFix: vi.fn(),
    });
    await vi.waitFor(() => expect(mocks.startAutoReview).toHaveBeenCalled());
    autoFix = false;
    finishReview(review({ chatId: 10 }));
    await run;

    expect(mocks.fixReviewFindings).not.toHaveBeenCalled();
  });

  it("replays the newest background auto-review requested while one is active", async () => {
    let resolveFirstReview!: (value: SubagentThreadSummary) => void;
    const firstReview = new Promise<SubagentThreadSummary>((resolve) => {
      resolveFirstReview = resolve;
    });
    mocks.startAutoReview
      .mockReturnValueOnce(firstReview)
      .mockResolvedValueOnce(
        review({
          id: "review-2",
          sourceMessageId: 43,
          result: { findingCount: 0 },
        }),
      );

    const firstRun = runBackgroundAutoReview({
      chatId: 9,
      sourceMessageId: 42,
      getAutoFix: () => false,
      streamFix: vi.fn(),
    });
    await vi.waitFor(() => {
      expect(mocks.startAutoReview).toHaveBeenCalledTimes(1);
    });

    await runBackgroundAutoReview({
      chatId: 9,
      sourceMessageId: 43,
      getAutoFix: () => false,
      streamFix: vi.fn(),
    });
    resolveFirstReview(
      review({ sourceMessageId: 42, result: { findingCount: 0 } }),
    );
    await firstRun;

    expect(mocks.startAutoReview).toHaveBeenCalledTimes(2);
    expect(mocks.startAutoReview).toHaveBeenNthCalledWith(1, {
      chatId: 9,
      sourceMessageId: 42,
    });
    expect(mocks.startAutoReview).toHaveBeenNthCalledWith(2, {
      chatId: 9,
      sourceMessageId: 43,
    });
    expect(mocks.fixReviewFindings).not.toHaveBeenCalled();
  });
});
