import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubagentThreadSummary } from "@/ipc/types";
import {
  clearPendingReviewContinuation,
  hasPendingReviewContinuation,
  resumePendingReviewContinuation,
} from "@/hooks/subagentReviewContinuation";
import { SubagentTeamCard } from "./SubagentTeamCard";

const mocks = vi.hoisted(() => ({
  cancelSubagent: vi.fn(),
  fixReviewFindings: vi.fn(),
  followupSubagent: vi.fn(),
  getSubagentMessages: vi.fn(),
  listSubagents: vi.fn(),
  onSubagentUpdate: vi.fn(),
  runAutoReviewBarrier: vi.fn(),
  showError: vi.fn(),
  skipReviewAutoFix: vi.fn(),
  sendSubagentMessage: vi.fn(),
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
      cancelSubagent: mocks.cancelSubagent,
      fixReviewFindings: mocks.fixReviewFindings,
      followupSubagent: mocks.followupSubagent,
      getSubagentMessages: mocks.getSubagentMessages,
      listSubagents: mocks.listSubagents,
      runAutoReviewBarrier: mocks.runAutoReviewBarrier,
      skipReviewAutoFix: mocks.skipReviewAutoFix,
      sendSubagentMessage: mocks.sendSubagentMessage,
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
    clearPendingReviewContinuation(7);
    mocks.onSubagentUpdate.mockReturnValue(vi.fn());
    mocks.startReview.mockResolvedValue(undefined);
    mocks.cancelSubagent.mockResolvedValue(undefined);
    mocks.sendSubagentMessage.mockResolvedValue(undefined);
    mocks.followupSubagent.mockResolvedValue("explorer");
    mocks.getSubagentMessages.mockResolvedValue([]);
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

  it("stops an active child and refreshes the team", async () => {
    mocks.listSubagents.mockResolvedValue([
      {
        ...makeReview("explorer-thread", 42, "exploration report"),
        persona: "explorer",
        taskName: "Find auth flow",
        status: "running",
      },
    ]);

    render(<SubagentTeamCard chatId={7} messageId={42} rootIsStreaming />, {
      wrapper: makeWrapper(),
    });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Stop explorer Find auth flow",
      }),
    );

    await waitFor(() => {
      expect(mocks.cancelSubagent).toHaveBeenCalledWith({
        chatId: 7,
        threadId: "explorer-thread",
      });
    });
    expect(
      screen
        .getByRole("button", { name: "Review changes" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("verifies a manual fix after a step-limit continuation completes", async () => {
    mocks.listSubagents.mockResolvedValue([
      makeReview("current-message", 42, "current report"),
    ]);
    mocks.streamMessage.mockImplementation(async ({ onSettled }) => {
      onSettled?.({ success: true, pausedByStepLimit: true });
    });

    render(<SubagentTeamCard chatId={7} messageId={42} />, {
      wrapper: makeWrapper(),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /Fix findings/ }),
    );

    await waitFor(() => expect(hasPendingReviewContinuation(7)).toBe(true));
    expect(mocks.runAutoReviewBarrier).not.toHaveBeenCalled();

    await resumePendingReviewContinuation(7);
    expect(mocks.runAutoReviewBarrier).toHaveBeenCalledWith({
      chatId: 7,
      verification: true,
    });
  });

  it("sends durable messages and routes Explorer follow-ups through a root Agent turn", async () => {
    mocks.listSubagents.mockResolvedValue([
      {
        ...makeReview("explorer-thread", 42, "exploration report"),
        persona: "explorer",
        taskName: "Find auth flow",
        assignment: "Trace auth",
        status: "running",
      },
    ]);

    render(<SubagentTeamCard chatId={7} messageId={42} />, {
      wrapper: makeWrapper(),
    });

    const messageInput = await screen.findByRole("textbox", {
      name: "Message explorer Find auth flow",
    });
    fireEvent.change(messageInput, { target: { value: "Check callbacks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(mocks.sendSubagentMessage).toHaveBeenCalledWith({
        chatId: 7,
        threadId: "explorer-thread",
        message: "Check callbacks",
      });
      expect((messageInput as HTMLTextAreaElement).value).toBe("");
    });

    fireEvent.change(messageInput, {
      target: { value: "Investigate the remaining gap" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Follow up" }));

    await waitFor(() => {
      expect(mocks.followupSubagent).not.toHaveBeenCalled();
      expect(mocks.streamMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 7,
          requestedChatMode: "local-agent",
          prompt: expect.stringContaining('thread_id: "explorer-thread"'),
        }),
      );
      expect(mocks.streamMessage.mock.calls.at(-1)?.[0].prompt).toContain(
        'message: "Investigate the remaining gap"',
      );
      expect((messageInput as HTMLTextAreaElement).value).toBe("");
    });
  });

  it("renders Explorer reports and lazily loads the durable transcript", async () => {
    mocks.listSubagents.mockResolvedValue([
      {
        ...makeReview("explorer-thread", 42, "exploration report"),
        persona: "explorer",
        taskName: "Find auth flow",
        assignment: "Trace auth",
      },
    ]);
    mocks.getSubagentMessages.mockResolvedValue([
      {
        id: 1,
        threadId: "explorer-thread",
        sequence: 1,
        messageId: "message-1",
        role: "root",
        content: "Check the callback path",
        consumed: true,
        createdAt: new Date(),
      },
      {
        id: 2,
        threadId: "explorer-thread",
        sequence: 2,
        messageId: "message-2",
        role: "assistant",
        content: "The callback is handled in auth.ts.",
        consumed: false,
        createdAt: new Date(),
      },
    ]);

    render(<SubagentTeamCard chatId={7} messageId={42} />, {
      wrapper: makeWrapper(),
    });

    expect(await screen.findByText("Find auth flow")).toBeTruthy();
    expect(mocks.getSubagentMessages).not.toHaveBeenCalled();
    expect(screen.queryByText("exploration report")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show details for explorer Find auth flow",
      }),
    );

    expect(await screen.findByText("exploration report")).toBeTruthy();
    expect(await screen.findByText("Check the callback path")).toBeTruthy();
    expect(
      screen.getByText("The callback is handled in auth.ts."),
    ).toBeTruthy();
    expect(mocks.getSubagentMessages).toHaveBeenCalledWith({
      chatId: 7,
      threadId: "explorer-thread",
    });
  });

  it("renders the bounded Implementer report in thread details", async () => {
    mocks.listSubagents.mockResolvedValue([
      {
        ...makeReview("implementer-thread", 42, "implementation report"),
        persona: "implementer",
        taskName: "Edit auth flow",
        assignment: "Implement auth",
      },
    ]);

    render(<SubagentTeamCard chatId={7} messageId={42} />, {
      wrapper: makeWrapper(),
    });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Show details for implementer Edit auth flow",
      }),
    );

    expect(await screen.findByText("implementation report")).toBeTruthy();
  });

  it("keeps Reviewer follow-ups on the direct read-only runner", async () => {
    mocks.listSubagents.mockResolvedValue([
      makeReview("review-thread", 42, "review report"),
    ]);

    render(<SubagentTeamCard chatId={7} messageId={42} />, {
      wrapper: makeWrapper(),
    });

    const messageInput = await screen.findByRole("textbox", {
      name: "Message reviewer Review review-thread",
    });
    fireEvent.change(messageInput, { target: { value: "Check this edge" } });
    fireEvent.click(screen.getByRole("button", { name: "Follow up" }));

    await waitFor(() => {
      expect(mocks.followupSubagent).toHaveBeenCalledWith({
        chatId: 7,
        threadId: "review-thread",
        message: "Check this edge",
      });
      expect((messageInput as HTMLTextAreaElement).value).toBe("");
    });
  });

  it.each([
    "auto_fix_countdown",
    "fixing_findings",
    "verification_review",
  ] as const)(
    "hides Fix findings while review status is %s",
    async (status) => {
      mocks.listSubagents.mockResolvedValue([
        {
          ...makeReview("current-message", 42, "current report"),
          status,
        },
      ]);

      render(<SubagentTeamCard chatId={7} messageId={42} />, {
        wrapper: makeWrapper(),
      });

      expect(await screen.findByText("current report")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Fix findings/ })).toBeNull();
    },
  );

  it("disables one-way messages for inactive sub-agents", async () => {
    mocks.listSubagents.mockResolvedValue([
      {
        ...makeReview("explorer-thread", 42, "exploration report"),
        persona: "explorer",
        taskName: "Find auth flow",
      },
    ]);

    render(<SubagentTeamCard chatId={7} messageId={42} />, {
      wrapper: makeWrapper(),
    });

    fireEvent.change(
      await screen.findByRole("textbox", {
        name: "Message explorer Find auth flow",
      }),
      { target: { value: "Check callbacks" } },
    );

    expect(
      screen
        .getByRole("button", { name: "Send message" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Follow up" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("surfaces durable message failures and keeps the draft", async () => {
    mocks.listSubagents.mockResolvedValue([
      {
        ...makeReview("explorer-thread", 42, "exploration report"),
        persona: "explorer",
        taskName: "Find auth flow",
        status: "running",
      },
    ]);
    const error = new Error("Message failed");
    mocks.sendSubagentMessage.mockRejectedValue(error);

    render(<SubagentTeamCard chatId={7} messageId={42} />, {
      wrapper: makeWrapper(),
    });

    const messageInput = await screen.findByRole("textbox", {
      name: "Message explorer Find auth flow",
    });
    fireEvent.change(messageInput, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(mocks.showError).toHaveBeenCalledWith(error));
    expect((messageInput as HTMLTextAreaElement).value).toBe("Keep this draft");
  });

  it("disables durable message actions while a send is pending", async () => {
    mocks.listSubagents.mockResolvedValue([
      {
        ...makeReview("explorer-thread", 42, "exploration report"),
        persona: "explorer",
        taskName: "Find auth flow",
        status: "running",
      },
    ]);
    let finishSend: (() => void) | undefined;
    mocks.sendSubagentMessage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSend = resolve;
        }),
    );

    render(<SubagentTeamCard chatId={7} messageId={42} />, {
      wrapper: makeWrapper(),
    });

    fireEvent.change(
      await screen.findByRole("textbox", {
        name: "Message explorer Find auth flow",
      }),
      { target: { value: "Check callbacks" } },
    );
    const sendButton = screen.getByRole("button", { name: "Send message" });
    fireEvent.click(sendButton);

    await waitFor(() => expect(sendButton.hasAttribute("disabled")).toBe(true));
    expect(
      screen
        .getByRole("button", { name: "Follow up" })
        .hasAttribute("disabled"),
    ).toBe(true);

    finishSend?.();
  });

  it("requires Implementer follow-ups to run through a root Agent turn", async () => {
    mocks.listSubagents.mockResolvedValue([
      {
        ...makeReview("implementer-thread", 42, "implementation report"),
        persona: "implementer",
        taskName: "Edit auth flow",
      },
    ]);

    render(<SubagentTeamCard chatId={7} messageId={42} />, {
      wrapper: makeWrapper(),
    });

    fireEvent.change(
      await screen.findByRole("textbox", {
        name: "Message implementer Edit auth flow",
      }),
      { target: { value: "Continue the edit" } },
    );
    const followup = screen.getByRole("button", { name: "Follow up" });
    expect(followup.hasAttribute("disabled")).toBe(true);
    expect(followup.getAttribute("title")).toMatch(/root Agent turn/);
  });
});
