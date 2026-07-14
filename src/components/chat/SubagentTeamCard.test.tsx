import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubagentThreadSummary } from "@/ipc/types";
import { SubagentTeamCard } from "./SubagentTeamCard";

const mocks = vi.hoisted(() => ({
  fixReviewFindings: vi.fn(),
  listSubagents: vi.fn(),
  onSubagentUpdate: vi.fn(),
  runAutoReviewBarrier: vi.fn(),
  showError: vi.fn(),
  skipReviewAutoFix: vi.fn(),
  startReview: vi.fn(),
  streamMessage: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { autoFixReviewIssues: true },
    updateSettings: vi.fn(),
  }),
}));

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ streamMessage: mocks.streamMessage }),
}));

vi.mock("@/lib/schemas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/schemas")>()),
  isDyadProEnabled: () => true,
}));

vi.mock("@/lib/toast", () => ({ showError: mocks.showError }));

vi.mock("@/ipc/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/types")>()),
  ipc: {
    agent: {
      fixReviewFindings: mocks.fixReviewFindings,
      listSubagents: mocks.listSubagents,
      runAutoReviewBarrier: mocks.runAutoReviewBarrier,
      skipReviewAutoFix: mocks.skipReviewAutoFix,
      startReview: mocks.startReview,
    },
    events: {
      agent: { onSubagentUpdate: mocks.onSubagentUpdate },
    },
  },
}));

function makeReview(
  id: string,
  sourceMessageId: number,
  report: string,
): SubagentThreadSummary {
  const now = new Date();
  return {
    id,
    chatId: 7,
    persona: "reviewer",
    taskName: `Review ${id}`,
    assignment: "Review changes",
    status: "completed",
    provider: "openai",
    model: "review-model",
    reasoningEffort: "medium",
    result: { findingCount: 1, report },
    reviewBaseCommit: "base",
    reviewTargetCommit: "target",
    reviewDiffHash: id,
    sourceMessageId,
    invocationSource: "review_button",
    autoFixAt: null,
    error: null,
    inputTokens: 1,
    outputTokens: 1,
    toolCallCount: 0,
    createdAt: now,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
  };
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("SubagentTeamCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onSubagentUpdate.mockReturnValue(vi.fn());
    mocks.startReview.mockResolvedValue(undefined);
    mocks.skipReviewAutoFix.mockResolvedValue(undefined);
    mocks.fixReviewFindings.mockResolvedValue({ prompt: "Fix current review" });
    mocks.runAutoReviewBarrier.mockResolvedValue({ outcome: "released" });
    mocks.streamMessage.mockImplementation(async ({ onSettled }) => {
      onSettled?.({ success: true });
    });
  });

  it("shows and fixes only the review for this assistant message", async () => {
    mocks.listSubagents.mockResolvedValue([
      makeReview("newer-other-message", 99, "stale report"),
      makeReview("current-message", 42, "current report"),
    ]);

    render(<SubagentTeamCard chatId={7} messageId={42} />, {
      wrapper: makeWrapper(),
    });

    expect(await screen.findByText("current report")).toBeTruthy();
    expect(screen.queryByText("stale report")).toBeNull();
    expect(mocks.fixReviewFindings).not.toHaveBeenCalled();
    expect(mocks.streamMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Fix findings/ }));

    await waitFor(() => {
      expect(mocks.fixReviewFindings).toHaveBeenCalledWith({
        chatId: 7,
        threadId: "current-message",
      });
      expect(mocks.streamMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Fix current review",
          chatId: 7,
          requestedChatMode: "local-agent",
          suppressAutoReview: true,
        }),
      );
      expect(mocks.runAutoReviewBarrier).toHaveBeenCalledWith({
        chatId: 7,
        verification: true,
      });
    });
  });

  it("starts a review for this exact assistant message", async () => {
    mocks.listSubagents.mockResolvedValue([]);

    render(<SubagentTeamCard chatId={7} messageId={42} />, {
      wrapper: makeWrapper(),
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Review changes" }),
    );

    await waitFor(() => {
      expect(mocks.startReview).toHaveBeenCalledWith({
        chatId: 7,
        sourceMessageId: 42,
      });
    });
  });
});
