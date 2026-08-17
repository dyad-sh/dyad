import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatAgentHistoryDialog } from "./ChatAgentHistoryDialog";

const conversation = {
  id: "conversation-1",
  title: "AI fitness presentation",
  updatedAt: Date.now(),
  messages: [{ id: "user-1", role: "user" as const, content: "Hello" }],
};

describe("Chat Agent conversation history", () => {
  it("requires confirmation before deleting from history and storage", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatAgentHistoryDialog
        open
        onOpenChange={vi.fn()}
        conversations={[conversation]}
        activeId="different-conversation"
        onSelect={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Delete conversation" }),
    );
    expect(screen.getByText("Delete conversation?")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete everywhere" }));
    expect(onDelete).toHaveBeenCalledWith("conversation-1");
  });
});
