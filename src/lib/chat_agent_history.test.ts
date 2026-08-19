import { describe, expect, it } from "vitest";

import type { ChatAgentOpenTab } from "@/components/chat-agent/types";
import { mergeSettledChatTabsIntoHistory } from "./chat_agent_history";

const tab = (id: string, busy = false): ChatAgentOpenTab => ({
  id,
  title: `Conversation ${id}`,
  messages: [
    { id: `${id}-user`, role: "user", content: "Hello" },
    ...(busy
      ? []
      : [{ id: `${id}-ai`, role: "assistant" as const, content: "Hi" }]),
  ],
  projectId: "project-1",
  updatedAt: id === "new" ? 2 : 1,
});

describe("Chat Agent history merging", () => {
  it("stores every settled open conversation with its project", () => {
    const result = mergeSettledChatTabsIntoHistory(
      [],
      [tab("old"), tab("new")],
      new Set(),
    );
    expect(result.map(({ id }) => id)).toEqual(["new", "old"]);
    expect(result[0]?.projectId).toBe("project-1");
  });

  it("does not snapshot a conversation while it is still responding", () => {
    expect(
      mergeSettledChatTabsIntoHistory(
        [],
        [tab("busy", true)],
        new Set(["busy"]),
      ),
    ).toEqual([]);
  });

  it("updates history when only retrieval selections change", () => {
    const existing = {
      ...tab("one"),
      vectorCollectionIds: ["old-knowledge"],
      dataSourceIds: ["old-database"],
    };
    const updated = {
      ...existing,
      vectorCollectionIds: ["new-knowledge"],
      dataSourceIds: ["new-database"],
    };
    const result = mergeSettledChatTabsIntoHistory(
      [existing],
      [updated],
      new Set(),
    );
    expect(result[0]).toMatchObject({
      vectorCollectionIds: ["new-knowledge"],
      dataSourceIds: ["new-database"],
    });
  });
});
