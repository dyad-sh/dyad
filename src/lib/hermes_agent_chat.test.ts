import { describe, expect, it } from "vitest";
import {
  buildHermesApiMessages,
  getHermesConversationTitle,
} from "./hermes_agent_chat";

describe("Hermes agent chat helpers", () => {
  it("omits the empty streaming placeholder from the Hermes request", () => {
    expect(
      buildHermesApiMessages([
        { id: "user", role: "user", content: "Hello Hermes" },
        { id: "assistant", role: "assistant", content: "" },
      ]),
    ).toEqual([{ role: "user", content: "Hello Hermes" }]);
  });

  it("keeps conversation titles concise and falls back for empty chats", () => {
    expect(getHermesConversationTitle([], "Hermes Phantom")).toBe(
      "Hermes Phantom",
    );
    expect(
      getHermesConversationTitle(
        [
          {
            id: "user",
            role: "user",
            content:
              "Summarise this very long project brief and identify its highest priority actions",
          },
        ],
        "Hermes Phantom",
      ),
    ).toBe("Summarise this very long project brief and ident…");
  });
});
