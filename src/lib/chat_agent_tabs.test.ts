import { describe, expect, it } from "vitest";

import type { ChatAgentOpenTab } from "@/components/chat-agent/types";
import {
  closeChatAgentTab,
  openChatAgentTab,
  syncChatAgentTab,
} from "./chat_agent_tabs";

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

  it("never resurrects a tab that another surface closed", () => {
    const tabs = [tab("still-open")];
    expect(
      syncChatAgentTab(tabs, {
        ...tab("already-closed"),
        title: "Late flush",
      }),
    ).toBe(tabs);
  });

  it("preserves project ownership while syncing live messages", () => {
    const messages = [{ id: "user", role: "user" as const, content: "Hi" }];
    const result = syncChatAgentTab(
      [{ ...tab("one"), projectId: "project-1" }],
      { ...tab("one"), messages, updatedAt: 2 },
    );
    expect(result[0]).toMatchObject({
      id: "one",
      projectId: "project-1",
      messages,
    });
  });

  it("keeps vector and database selections with the conversation", () => {
    const result = syncChatAgentTab([tab("one")], {
      ...tab("one"),
      vectorCollectionIds: ["knowledge"],
      dataSourceIds: ["orders"],
      updatedAt: 2,
    });
    expect(result[0]).toMatchObject({
      vectorCollectionIds: ["knowledge"],
      dataSourceIds: ["orders"],
    });
  });
});
