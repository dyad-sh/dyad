import { describe, expect, it } from "vitest";
import {
  ChatStreamIntentEventSchema,
  SerializableChatTurnIntentSchema,
} from "./transport";

describe("chat stream remote transport", () => {
  const intent = {
    schemaVersion: 1 as const,
    intentId: "turn-1",
    payloadHash: "hash",
    chatId: 12,
    invocationRef: {
      kind: "chat-stream" as const,
      entityKey: 12,
      operationId: "operation-1",
    },
    prompt: "Build it",
  };

  it("rejects an invocation routed to a different chat", () => {
    expect(() =>
      SerializableChatTurnIntentSchema.parse({
        ...intent,
        invocationRef: { ...intent.invocationRef, entityKey: 13 },
      }),
    ).toThrow(/routed chat/);
  });

  it("strips fields outside the reviewed intent envelope", () => {
    const parsed = ChatStreamIntentEventSchema.parse({
      type: "SUBMIT",
      intent: {
        ...intent,
        accessToken: "must-not-cross",
      },
    });

    expect(parsed.type).toBe("SUBMIT");
    if (parsed.type !== "SUBMIT") return;
    expect(parsed.intent).not.toHaveProperty("accessToken");
  });

  it("requires queue revisions for cross-window mutations", () => {
    expect(() =>
      ChatStreamIntentEventSchema.parse({
        type: "PAUSE_QUEUE",
        mutationId: "pause",
      }),
    ).toThrow();
  });
});
