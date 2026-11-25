import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatId: 7 as number | null,
  savedPlan: null as null | { id: string; chatId: number; content: string },
  planContent: undefined as string | undefined,
}));

vi.mock("jotai", () => ({
  useAtomValue: () => mocks.chatId,
  useSetAtom: () => vi.fn(),
}));
vi.mock("@/atoms/appAtoms", () => ({ previewModeAtom: Symbol() }));
vi.mock("@/atoms/chatAtoms", () => ({ selectedChatIdAtom: Symbol() }));
vi.mock("@/atoms/viewAtoms", () => ({ isPreviewOpenAtom: Symbol() }));
vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => ({ savedPlan: mocks.savedPlan, hasPlanInMemory: true }),
}));
vi.mock("@/hooks/usePlanDocument", () => ({
  usePlanDocument: () =>
    mocks.planContent === undefined
      ? undefined
      : { content: mocks.planContent, title: "Add authentication" },
}));

import { DyadWritePlan } from "./DyadWritePlan";

const node = { properties: { title: "Add authentication" } };

async function planFileTooltip(label: string): Promise<string | null> {
  const trigger = screen.getByRole("button", { name: label });
  act(() => trigger.focus());
  const tooltip = await screen.findByText(/\.md$/);
  const text = tooltip.textContent;
  act(() => trigger.blur());
  return text;
}

describe("DyadWritePlan", () => {
  beforeEach(() => {
    mocks.chatId = 7;
    mocks.savedPlan = null;
    mocks.planContent = undefined;
  });

  it("names a saved legacy plan by its own file, except while a new plan is generating", async () => {
    mocks.savedPlan = {
      id: "chat-7-20260101",
      chatId: 7,
      content: "Implementation steps",
    };
    mocks.planContent = "Implementation steps";
    const { rerender } = render(<DyadWritePlan node={node} />);
    expect(await planFileTooltip("Plan #7")).toBe("chat-7-20260101.md");

    rerender(
      <DyadWritePlan
        node={{ properties: { ...node.properties, complete: "false" } }}
      />,
    );
    expect(await planFileTooltip("Plan #7")).toBe("chat-7-plan.md");
  });

  it("names a newer plan by the canonical file while the legacy plan stays cached", async () => {
    mocks.savedPlan = {
      id: "chat-7-20260101",
      chatId: 7,
      content: "Implementation steps",
    };
    mocks.planContent = "Revised steps";
    render(<DyadWritePlan node={node} />);
    expect(await planFileTooltip("Plan #7")).toBe("chat-7-plan.md");
  });

  it("shows the plan number beside the title, including while generating", async () => {
    const { rerender } = render(<DyadWritePlan node={node} />);
    expect(screen.getByText("Add authentication")).toBeTruthy();
    expect(await planFileTooltip("Plan #7")).toBe("chat-7-plan.md");

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
