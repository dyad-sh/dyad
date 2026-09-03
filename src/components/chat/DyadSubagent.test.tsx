import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubagentActivity, SubagentThreadSummary } from "@/ipc/types";
import { DyadSubagent } from "./DyadSubagent";

const mocks = vi.hoisted(() => ({
  cancelSubagent: vi.fn(),
  getSubagentActivities: vi.fn(),
  listSubagents: vi.fn(),
  onSubagentUpdate: vi.fn(),
}));

vi.mock("@/ipc/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/types")>()),
  ipc: {
    agent: {
      cancelSubagent: mocks.cancelSubagent,
      getSubagentActivities: mocks.getSubagentActivities,
      listSubagents: mocks.listSubagents,
    },
    events: { agent: { onSubagentUpdate: mocks.onSubagentUpdate } },
  },
}));

function makeThread(status: SubagentThreadSummary["status"]) {
  const now = new Date();
  return {
    id: "explorer-1",
    chatId: 7,
    persona: "explorer",
    taskName: "Trace authentication",
    assignment: "Find the auth flow",
    status,
    provider: "openai",
    model: "explorer-model",
    reasoningEffort: "high",
    result:
      status === "completed" ? { report: "Auth starts in auth.ts." } : null,
    reviewBaseCommit: null,
    reviewTargetCommit: null,
    reviewDiffHash: null,
    sourceMessageId: 42,
    invocationSource: "model",
    remediationSource: null,
    autoFixAt: null,
    error: null,
    inputTokens: 1,
    outputTokens: 1,
    toolCallCount: 1,
    createdAt: now,
    startedAt: now,
    completedAt: status === "completed" ? now : null,
    updatedAt: now,
  } satisfies SubagentThreadSummary;
}

function makeActivity(): SubagentActivity {
  return {
    id: 3,
    threadId: "explorer-1",
    sequence: 1,
    toolCallId: "call-grep",
    toolName: "grep",
    status: "completed",
    presentationXml:
      '<dyad-grep query="auth" count="1">src/auth.ts:1: auth</dyad-grep>',
    error: null,
    startedAt: new Date(),
    completedAt: new Date(),
  };
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("DyadSubagent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancelSubagent.mockResolvedValue(undefined);
    mocks.onSubagentUpdate.mockReturnValue(vi.fn());
    mocks.getSubagentActivities.mockResolvedValue([makeActivity()]);
  });

  it("shows live tool activity and collapses into findings when complete", async () => {
    let status: SubagentThreadSummary["status"] = "running";
    let notify:
      | ((event: { chatId: number; threadId: string }) => void)
      | undefined;
    mocks.listSubagents.mockImplementation(async () => [makeThread(status)]);
    mocks.onSubagentUpdate.mockImplementation((listener) => {
      notify = listener;
      return vi.fn();
    });
    const renderActivity = vi.fn((xml: string) => <div>{xml}</div>);

    render(
      <DyadSubagent
        chatId={7}
        threadId="explorer-1"
        persona="explorer"
        taskName="Trace authentication"
        renderActivity={renderActivity}
      />,
      { wrapper: makeWrapper() },
    );

    expect(await screen.findByText(/dyad-grep state/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Stop explorer/ })).toBeTruthy();
    expect(renderActivity).toHaveBeenCalledWith(
      makeActivity().presentationXml.replace(
        "<dyad-grep",
        '<dyad-grep state="finished"',
      ),
      3,
      "completed",
    );

    status = "completed";
    notify?.({ chatId: 7, threadId: "explorer-1" });

    await waitFor(() => {
      expect(screen.queryByText(/dyad-grep state/)).toBeNull();
      expect(
        screen.queryByRole("button", { name: /Stop explorer/ }),
      ).toBeNull();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Trace authentication/ }),
    );
    expect(await screen.findByText("Auth starts in auth.ts.")).toBeTruthy();
  });

  it.each(["partial", "review_outdated", "cancelled"] as const)(
    "renders %s as a warning instead of a failure",
    async (status) => {
      mocks.listSubagents.mockResolvedValue([makeThread(status)]);
      mocks.getSubagentActivities.mockResolvedValue([]);

      const { container } = render(
        <DyadSubagent
          chatId={7}
          threadId="explorer-1"
          persona="explorer"
          taskName="Trace authentication"
          renderActivity={() => null}
        />,
        { wrapper: makeWrapper() },
      );

      await screen.findByText(
        status === "partial"
          ? /Partial findings/
          : new RegExp(status.replaceAll("_", " "), "i"),
      );
      expect(container.querySelector("svg.text-amber-600")).toBeTruthy();
      expect(container.querySelector("svg.text-destructive")).toBeNull();
    },
  );

  it("shows a nonterminal stopping state without offering another stop", async () => {
    mocks.listSubagents.mockResolvedValue([makeThread("stopping")]);
    mocks.getSubagentActivities.mockResolvedValue([]);

    render(
      <DyadSubagent
        chatId={7}
        threadId="explorer-1"
        persona="explorer"
        taskName="Trace authentication"
        renderActivity={() => null}
      />,
      { wrapper: makeWrapper() },
    );

    expect(
      await screen.findByText(/Stop requested · tool still finishing/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Stop explorer/ })).toBeNull();
  });

  it("shows a failed thread error and its latest activity error", async () => {
    mocks.listSubagents.mockResolvedValue([
      { ...makeThread("failed"), error: "Model request failed." },
    ]);
    mocks.getSubagentActivities.mockResolvedValue([
      {
        ...makeActivity(),
        status: "error",
        error: "Command exited with code 1.",
      },
    ]);

    render(
      <DyadSubagent
        chatId={7}
        threadId="explorer-1"
        persona="explorer"
        taskName="Trace authentication"
        renderActivity={() => null}
      />,
      { wrapper: makeWrapper() },
    );

    await screen.findByText(/failed/i);
    fireEvent.click(
      screen.getByRole("button", { name: /Trace authentication/ }),
    );
    expect(await screen.findByText("Model request failed.")).toBeTruthy();
    expect(
      screen.getByText(
        "Latest action: grep (error): Command exited with code 1.",
      ),
    ).toBeTruthy();
  });

  it("does not style a completed latest activity as the failure cause", async () => {
    mocks.listSubagents.mockResolvedValue([
      { ...makeThread("failed"), error: "The following model step failed." },
    ]);
    mocks.getSubagentActivities.mockResolvedValue([makeActivity()]);

    render(
      <DyadSubagent
        chatId={7}
        threadId="explorer-1"
        persona="explorer"
        taskName="Trace authentication"
        renderActivity={() => null}
      />,
      { wrapper: makeWrapper() },
    );

    await screen.findByText(/failed/i);
    fireEvent.click(
      screen.getByRole("button", { name: /Trace authentication/ }),
    );
    expect(screen.queryByText(/Latest action: grep \(completed\)/)).toBeNull();
  });
});
