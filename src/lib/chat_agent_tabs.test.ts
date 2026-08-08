import { describe, expect, it } from "vitest";

import type { ChatAgentOpenTab } from "@/components/chat-agent/types";
import { closeChatAgentTab, openChatAgentTab } from "./chat_agent_tabs";

function tab(id: string): ChatAgentOpenTab {
  return {
    id,
    title: id,
    messages: [],
    updatedAt: 1,
  };
}

describe("Chat Agent conversation tabs", () => {
  it("opens a saved conversation once", () => {
    const tabs = [tab("one")];
    expect(openChatAgentTab(tabs, tab("two")).map(({ id }) => id)).toEqual([
      "one",
      "two",
    ]);
    expect(openChatAgentTab(tabs, tab("one"))).toBe(tabs);
  });

  it("selects the adjacent tab without deleting conversation data", () => {
    const result = closeChatAgentTab(
      [tab("one"), tab("two"), tab("three")],
      "two",
    );
    expect(result.tabs.map(({ id }) => id)).toEqual(["one", "three"]);
    expect(result.fallback?.id).toBe("three");
  });
});
