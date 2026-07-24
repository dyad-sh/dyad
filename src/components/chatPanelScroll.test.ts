import { describe, expect, it } from "vitest";

import { automaticChatScrollReason } from "./chatPanelScroll";

describe("automaticChatScrollReason", () => {
  const base = {
    previousChatId: 7,
    chatId: 7,
    previousOperationId: "",
    operationId: "",
    pendingInitialScrollChatId: undefined,
    messagesLength: 2,
  };

  it("scrolls when a new operation starts", () => {
    expect(
      automaticChatScrollReason({
        ...base,
        operationId: "operation-1",
      }),
    ).toBe("stream-start");
  });

  it("does not scroll when an operation settles to idle", () => {
    expect(
      automaticChatScrollReason({
        ...base,
        previousOperationId: "operation-1",
        operationId: "",
      }),
    ).toBeNull();
  });

  it("scrolls on chat switches and delayed initial message loads", () => {
    expect(
      automaticChatScrollReason({
        ...base,
        previousChatId: 6,
      }),
    ).toBe("chat-switch");
    expect(
      automaticChatScrollReason({
        ...base,
        pendingInitialScrollChatId: 7,
      }),
    ).toBe("initial-messages-loaded");
  });
});
