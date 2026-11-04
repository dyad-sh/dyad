import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chatId: 7 as number | null }));

vi.mock("jotai", () => ({
  useAtomValue: () => mocks.chatId,
  useSetAtom: () => vi.fn(),
}));
vi.mock("@/atoms/appAtoms", () => ({ previewModeAtom: Symbol() }));
vi.mock("@/atoms/chatAtoms", () => ({ selectedChatIdAtom: Symbol() }));
vi.mock("@/atoms/viewAtoms", () => ({ isPreviewOpenAtom: Symbol() }));
vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => ({ savedPlan: null, hasPlanInMemory: true }),
}));

import { DyadWritePlan } from "./DyadWritePlan";

const node = { properties: { title: "Add authentication" } };

describe("DyadWritePlan", () => {
  beforeEach(() => {
    mocks.chatId = 7;
  });

  it("shows the plan number beside the title, including while generating", () => {
    const { rerender } = render(<DyadWritePlan node={node} />);
    expect(screen.getByText("Add authentication")).toBeTruthy();
    expect(screen.getByText("Plan #7").title).toBe("chat-7-plan.md");

    rerender(
      <DyadWritePlan
        node={{ properties: { ...node.properties, complete: "false" } }}
      />,
    );
    expect(screen.getByText("Plan #7")).toBeTruthy();
    expect(screen.getByText("Generating plan...")).toBeTruthy();
  });

  it("updates the number on chat switches and omits it without a chat", () => {
    const { rerender } = render(<DyadWritePlan node={node} />);
    mocks.chatId = 12;
    rerender(<DyadWritePlan node={node} />);
    expect(screen.getByText("Plan #12")).toBeTruthy();
    expect(screen.queryByText("Plan #7")).toBeNull();

    mocks.chatId = null;
    rerender(<DyadWritePlan node={node} />);
    expect(screen.queryByText(/Plan #/)).toBeNull();
  });
});
