import { describe, expect, it, vi } from "vitest";
import type { ChatStreamExecutionObserver } from "./chat_stream_handlers";
import { settleUnobservedChatStreamResult } from "./chat_stream_handlers";

function observer(): ChatStreamExecutionObserver {
  return {
    intent: {
      schemaVersion: 1,
      intentId: "intent",
      payloadHash: "hash",
      chatId: 7,
      prompt: "hello",
    },
    sessionQueued: false,
    onEnd: vi.fn(),
    onError: vi.fn(),
  };
}

describe("settleUnobservedChatStreamResult", () => {
  it("synthesizes successful completion when a handler returns silently", () => {
    const target = observer();

    settleUnobservedChatStreamResult({ chatId: 7, prompt: "hello" }, 7, target);

    expect(target.onEnd).toHaveBeenCalledWith({
      chatId: 7,
      updatedFiles: false,
    });
    expect(target.onError).not.toHaveBeenCalled();
  });

  it("synthesizes an error when a failed handler returns silently", () => {
    const target = observer();

    settleUnobservedChatStreamResult(
      { chatId: 7, prompt: "hello" },
      "error",
      target,
    );

    expect(target.onError).toHaveBeenCalledWith({
      chatId: 7,
      error: "Chat stream ended without reporting a terminal error",
    });
    expect(target.onEnd).not.toHaveBeenCalled();
  });
});
