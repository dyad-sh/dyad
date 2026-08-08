import { describe, expect, it } from "vitest";
import { pruneEmptyAssistantMessages } from "./chat_agent_messages";

describe("pruneEmptyAssistantMessages", () => {
  it("removes blank assistant turns but keeps card-only replies", () => {
    expect(
      pruneEmptyAssistantMessages([
        { id: "user", role: "user", content: "10 nights" },
        { id: "empty", role: "assistant", content: "" },
        {
          id: "card",
          role: "assistant",
          content: "",
          toolResults: [
            {
              serverName: "Travel Search",
              toolName: "Flexible flight search",
              result: "{}",
              status: "completed",
            },
          ],
        },
      ]).map((message) => message.id),
    ).toEqual(["user", "card"]);
  });
});
