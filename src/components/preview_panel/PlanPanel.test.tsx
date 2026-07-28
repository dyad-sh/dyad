import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptPlan: vi.fn(),
  handoffState: {
    phase: "idle",
    failure: null,
  } as { phase: string; failure: string | null },
  streamMessage: vi.fn(),
  setAcceptInNewChat: vi.fn(),
}));

vi.mock("@/atoms/planAtoms", () => ({
  clearPlanAnnotations: vi.fn(),
  planAcceptInNewChatByChatIdAtom: Symbol("accept-in-new-chat"),
  planAnnotationsAtom: Symbol("annotations"),
}));
vi.mock("@/atoms/appAtoms", () => ({
  previewModeAtom: Symbol("preview-mode"),
  selectedAppIdAtom: Symbol("app-id"),
}));
vi.mock("@/atoms/chatAtoms", () => ({
  selectedChatIdAtom: Symbol("chat-id"),
}));
vi.mock("jotai", () => ({
  useAtomValue: vi.fn((atom: symbol) => {
    switch (atom.description) {
      case "chat-id":
        return 7;
      case "app-id":
        return 3;
      case "preview-mode":
        return "plan";
      case "annotations":
        return new Map();
      default:
        return undefined;
    }
  }),
  useSetAtom: vi.fn(() => vi.fn()),
  useAtom: vi.fn(() => [new Map(), mocks.setAcceptInNewChat]),
}));
vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({
    streamMessage: mocks.streamMessage,
    isStreaming: false,
  }),
}));
vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => ({ savedPlan: null }),
}));
vi.mock("@/hooks/useChatMode", () => ({
  useChatMode: () => ({ selectedMode: "plan" }),
}));
vi.mock("@/hooks/usePlanDocument", () => ({
  usePlanDocument: () => ({
    content: "Implementation steps",
    title: "Plan",
    summary: null,
  }),
}));
vi.mock("@/plan_handoff/usePlanHandoff", () => ({
  usePlanHandoff: () => ({ acceptPlan: mocks.acceptPlan }),
  usePlanHandoffState: () => mocks.handoffState,
}));
vi.mock("@/components/chat/DyadMarkdownParser", () => ({
  VanillaMarkdownParser: ({ content }: { content: string }) => (
    <div>{content}</div>
  ),
}));
vi.mock("./plan/SelectionCommentButton", () => ({
  SelectionCommentButton: () => null,
}));
vi.mock("./plan/CommentsFloatingButton", () => ({
  CommentsFloatingButton: () => null,
}));
vi.mock("./plan/CommentPopover", () => ({
  CommentPopover: () => null,
}));
vi.mock("./plan/planAnnotationDom", () => ({
  applyPlanAnnotationHighlights: vi.fn(),
  clearPlanAnnotationHighlights: vi.fn(),
}));

import { PlanPanel } from "./PlanPanel";

describe("PlanPanel", () => {
  beforeEach(() => {
    mocks.acceptPlan.mockReset();
    mocks.handoffState.phase = "idle";
    mocks.handoffState.failure = null;
    mocks.streamMessage.mockReset();
    mocks.setAcceptInNewChat.mockReset();
  });

  it.each([
    { success: false, label: "failed" },
    { success: true, label: "completed without a handoff" },
  ])("re-enables acceptance after a $label turn", ({ success }) => {
    let settle: ((result: { success: boolean }) => void) | undefined;
    mocks.streamMessage.mockImplementation(
      ({ onSettled }: { onSettled?: typeof settle }) => {
        settle = onSettled;
      },
    );
    render(<PlanPanel />);
    const button = screen.getByTestId(
      "accept-plan-new-chat",
    ) as HTMLButtonElement;

    fireEvent.click(button);
    expect(button.disabled).toBe(true);

    act(() => settle?.({ success }));
    expect(button.disabled).toBe(false);
  });

  it("re-enables acceptance when a handoff retry rejects", async () => {
    mocks.handoffState.phase = "failed";
    mocks.handoffState.failure = "Previous attempt failed";
    mocks.acceptPlan.mockRejectedValue(new Error("Dispatch failed"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(<PlanPanel />);
    const button = screen.getByTestId(
      "accept-plan-new-chat",
    ) as HTMLButtonElement;

    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(button.disabled).toBe(false);

    consoleError.mockRestore();
  });
});
