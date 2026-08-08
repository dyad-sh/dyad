import { describe, expect, it } from "vitest";

import {
  buildChatAgentRecallQuery,
  limitChatAgentConversation,
  prependChatAgentContext,
  type ChatAgentContextMessage,
} from "./chat_agent_context";

describe("chat agent context", () => {
  const hulkHoganFollowUp: ChatAgentContextMessage[] = [
    { role: "user", content: "who was hulk hogan" },
    {
      role: "assistant",
      content: "Hulk Hogan was an American professional wrestler.",
    },
    { role: "user", content: "find the latest news about him" },
  ];

  it("preserves the subject of a short follow-up in the recall query", () => {
    expect(buildChatAgentRecallQuery(hulkHoganFollowUp)).toBe(
      "who was hulk hogan\n\nfind the latest news about him",
    );
  });

  it("keeps live conversation after supplemental vault memory", () => {
    const result = prependChatAgentContext(
      hulkHoganFollowUp,
      "<retrieved_memory>Older unrelated notes</retrieved_memory>",
    );

    expect(result.slice(-3)).toEqual(hulkHoganFollowUp);
    expect(result[0]?.content).toContain("Older unrelated notes");
  });

  it("keeps the current prompt and configured number of previous turns", () => {
    const history: ChatAgentContextMessage[] = [
      { role: "user", content: "one" },
      { role: "assistant", content: "one answer" },
      { role: "user", content: "two" },
      { role: "assistant", content: "two answer" },
      { role: "user", content: "three" },
      { role: "assistant", content: "three answer" },
      { role: "user", content: "follow up" },
    ];

    expect(limitChatAgentConversation(history, 2)).toEqual(history.slice(-5));
  });
});
