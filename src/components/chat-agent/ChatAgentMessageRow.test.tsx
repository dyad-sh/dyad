import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatAgentAssistantAvatar } from "./ChatAgentMessageRow";

afterEach(cleanup);

describe("ChatAgentAssistantAvatar", () => {
  it("renders a Hermes agent's uploaded avatar image", () => {
    render(
      <ChatAgentAssistantAvatar
        avatar="data:image/jpeg;base64,aGVybWVz"
        name="Hermes Phantom"
      />,
    );

    const image = screen.getByRole("img", {
      name: "Hermes Phantom avatar",
    });
    expect(image.getAttribute("src")).toBe("data:image/jpeg;base64,aGVybWVz");
  });

  it("renders the agent's selected emoji avatar", () => {
    render(<ChatAgentAssistantAvatar avatar="🪽" name="Hermes Phantom" />);

    expect(
      screen.getByRole("img", { name: "Hermes Phantom avatar" }).textContent,
    ).toBe("🪽");
  });
});
