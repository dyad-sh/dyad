import { describe, expect, it } from "vitest";

import type { ChatAgentMessage } from "@/components/chat-agent/types";
import { chatAgentConversationTitle } from "./chat_agent_conversation_title";

const user = (content: string): ChatAgentMessage => ({
  id: "message-1",
  role: "user",
  content,
});

describe("Chat Agent conversation titles", () => {
  it("uses a concise first-line title", () => {
    expect(
      chatAgentConversationTitle([
        user("Plan my fitness launch\nMore details"),
      ]),
    ).toBe("Plan my fitness launch");
  });

  it("uses the visible request instead of MCP control text", () => {
    expect(
      chatAgentConversationTitle([
        user(
          "MCP_TOOL_MENU_SELECTION\nTool: generate-design\nUser request: Create a Canva presentation about AI fitness",
        ),
      ]),
    ).toBe("Create a Canva presentation about AI fitness");
  });

  it("truncates on a useful word boundary", () => {
    const title = chatAgentConversationTitle([
      user(
        "Create an exceptionally detailed presentation about artificial intelligence in modern fitness coaching",
      ),
    ]);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(57);
  });
});
