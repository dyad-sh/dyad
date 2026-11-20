import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueuedMessagesList } from "./QueuedMessagesList";
import type { QueuedMessageItem } from "@/atoms/chatAtoms";

afterEach(cleanup);

function renderList(
  messages: QueuedMessageItem[],
  onSendNow?: (id: string) => void,
) {
  const noop = vi.fn();
  render(
    <QueuedMessagesList
      messages={messages}
      onEdit={noop}
      onDelete={noop}
      onMoveUp={noop}
      onMoveDown={noop}
      isStreaming
      hasError={false}
      isPaused={false}
      onPauseQueue={noop}
      onResumeQueue={noop}
      onSendNow={onSendNow}
    />,
  );
}

const sendNowButtons = () =>
  screen.queryAllByRole("button", {
    name: "Send now to the running Claude Code turn",
  });

it("offers Send now for plain queued text while a native turn runs", () => {
  const onSendNow = vi.fn();
  renderList([{ id: "a", prompt: "Also add a footer" }], onSendNow);
  fireEvent.click(sendNowButtons()[0]);
  expect(onSendNow).toHaveBeenCalledWith("a");
});

it("hides Send now when the running turn cannot take messages", () => {
  renderList([{ id: "a", prompt: "Also add a footer" }]);
  expect(sendNowButtons()).toHaveLength(0);
});

it("keeps messages with attachments, components or redo for their own turn", () => {
  renderList(
    [
      {
        id: "a",
        prompt: "With a file",
        attachments: [{ file: new File(["x"], "a.txt"), type: "chat-context" }],
      } as QueuedMessageItem,
      {
        id: "b",
        prompt: "With a component",
        selectedComponents: [{} as never],
      },
      { id: "c", prompt: "Retry", redo: true },
      { id: "d", prompt: "Plain" },
    ],
    vi.fn(),
  );
  expect(sendNowButtons()).toHaveLength(1);
});
