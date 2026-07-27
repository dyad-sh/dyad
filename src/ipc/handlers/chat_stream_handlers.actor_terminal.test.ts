import { describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
import type { ChatStreamExecutionObserver } from "./chat_stream_handlers";
import {
  createObservedChatStreamSender,
  settleUnobservedChatStreamResult,
} from "./chat_stream_handlers";

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

describe("createObservedChatStreamSender", () => {
  it("makes a captured endpoint non-registrable after it is destroyed", () => {
    let destroyed = false;
    const send = vi.fn();
    const observeTerminal = vi.fn();
    const sender = {
      id: 42,
      isDestroyed: () => destroyed,
      isCrashed: () => false,
      send,
    } as unknown as WebContents;
    const observed = createObservedChatStreamSender(sender, observeTerminal);

    expect(observed.id).toBe(42);
    destroyed = true;

    expect(Number.isInteger(observed.id)).toBe(false);
    observed.send("chat:response:end", { chatId: 7 });
    expect(observeTerminal).toHaveBeenCalledWith("chat:response:end", {
      chatId: 7,
    });
    expect(send).not.toHaveBeenCalled();
  });
});
