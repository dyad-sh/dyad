import { describe, expect, it } from "vitest";
import {
  buildMessageHistory,
  toHistoryChatMessages,
  type HistoryMessage,
} from "./message_history_builder";

function msg(
  role: "user" | "assistant" | "system",
  content: string,
): HistoryMessage {
  return { role, content };
}

describe("buildMessageHistory", () => {
  it("returns messages unchanged when under the turn limit", () => {
    const history = buildMessageHistory({
      messages: [msg("user", "hi"), msg("assistant", "hello")],
      maxChatTurns: 5,
    });
    expect(history.map((m) => m.content)).toEqual(["hi", "hello"]);
  });

  it("replaces the last user message content when requested", () => {
    const history = buildMessageHistory({
      messages: [
        msg("user", "first"),
        msg("assistant", "reply"),
        msg("user", "/implement-plan=my-plan"),
        msg("assistant", ""),
      ],
      replaceLastUserMessageWith: "expanded plan prompt",
      maxChatTurns: 5,
    });
    expect(history[2].content).toBe("expanded plan prompt");
    expect(history[0].content).toBe("first");
  });

  it("limits history to the most recent turns", () => {
    const messages: HistoryMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(msg("user", `u${i}`));
      messages.push(msg("assistant", `a${i}`));
    }
    const history = buildMessageHistory({
      messages,
      maxChatTurns: 2,
    });
    expect(history.map((m) => m.content)).toEqual(["u8", "a8", "u9", "a9"]);
  });

  it("drops leading assistant messages so the window starts with a user message", () => {
    const messages: HistoryMessage[] = [msg("user", "u0")];
    for (let i = 0; i < 5; i++) {
      messages.push(msg("assistant", `a${i}`));
      messages.push(msg("user", `u${i + 1}`));
    }
    messages.push(msg("assistant", "a-last"));
    // 12 messages; maxChatTurns 2 -> last 4 = [u4, a4(? depends)] — assert invariant instead
    const history = buildMessageHistory({
      messages,
      maxChatTurns: 2,
    });
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].role).toBe("user");
  });

  it("filters cancelled message pairs", () => {
    const history = buildMessageHistory({
      messages: [
        msg("user", "do something"),
        msg("assistant", "partial response\n\n[Response cancelled by user]"),
        msg("user", "actual request"),
        msg("assistant", "done"),
      ],
      maxChatTurns: 10,
    });
    // The cancelled pair should be removed
    expect(
      history.find((m) => m.content.includes("Response cancelled")),
    ).toBeUndefined();
    expect(history.find((m) => m.content === "do something")).toBeUndefined();
    expect(history.map((m) => m.content)).toEqual(["actual request", "done"]);
  });
});

describe("toHistoryChatMessages", () => {
  it("strips thinking and problem-report tags in build mode but keeps dyad tags", () => {
    const result = toHistoryChatMessages({
      history: [
        msg(
          "assistant",
          '<think>reasoning</think><dyad-write path="a.ts">code</dyad-write>done',
        ),
      ],
      selectedChatMode: "build",
    });
    expect(result[0].content).not.toContain("<think>");
    expect(result[0].content).toContain("<dyad-write");
  });

  it("also strips dyad tags in ask mode", () => {
    const result = toHistoryChatMessages({
      history: [
        msg(
          "assistant",
          '<dyad-write path="a.ts">code</dyad-write>explanation',
        ),
      ],
      selectedChatMode: "ask",
    });
    expect(result[0].content).not.toContain("<dyad-write");
    expect(result[0].content).toContain("explanation");
  });

  it("threads commit hashes into provider options", () => {
    const result = toHistoryChatMessages({
      history: [
        {
          role: "assistant",
          content: "x",
          sourceCommitHash: "abc",
          commitHash: "def",
        },
      ],
      selectedChatMode: "build",
    });
    expect(result[0].providerOptions["dyad-engine"]).toEqual({
      sourceCommitHash: "abc",
      commitHash: "def",
    });
  });
});
