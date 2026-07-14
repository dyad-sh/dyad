import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubagentThreadSummary } from "@/ipc/types/agent";

const mocks = vi.hoisted(() => ({
  startAutoReview: vi.fn(),
  listSubagents: vi.fn(),
  fixReviewFindings: vi.fn(),
  runAutoReviewBarrier: vi.fn(),
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
  shouldStartBackgroundAutoReview,
} from "./useStreamChat";
import { runQueuedReviewFlow } from "./useQueueProcessor";

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
      return true;
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
        streamRemediation: async () => false,
        onRemediationFailed,
      }),
    ).resolves.toBe("released");
    expect(runBarrier).toHaveBeenCalledTimes(1);
    expect(onRemediationFailed).toHaveBeenCalledWith("review-1");
  });

  it("auto-fixes a background review only when enabled, then verifies", async () => {
    mocks.startAutoReview.mockResolvedValue(review());
    mocks.fixReviewFindings.mockResolvedValue({ prompt: "fix it" });
    mocks.runAutoReviewBarrier.mockResolvedValue({ outcome: "released" });
    const streamFix = vi.fn(async () => true);

    await runBackgroundAutoReview({
      chatId: 7,
      sourceMessageId: 42,
      autoFix: true,
      streamFix,
    });

    expect(streamFix).toHaveBeenCalledWith("fix it");
    expect(mocks.runAutoReviewBarrier).toHaveBeenCalledWith({
      chatId: 7,
      verification: true,
    });
  });

  it("reports a background review without fixing when auto-fix is disabled", async () => {
    mocks.startAutoReview.mockResolvedValue(review());

    await runBackgroundAutoReview({
      chatId: 7,
      sourceMessageId: 42,
      autoFix: false,
      streamFix: vi.fn(),
    });

    expect(mocks.fixReviewFindings).not.toHaveBeenCalled();
    expect(mocks.runAutoReviewBarrier).not.toHaveBeenCalled();
  });
});
