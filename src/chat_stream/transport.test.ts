import { describe, expect, it } from "vitest";
import { MAX_CHAT_ATTACHMENTS_TOTAL_BYTES } from "@/shared/chatAttachmentLimits";
import {
  CHAT_STREAM_MAX_DISPATCH_ENVELOPE_BYTES,
  CHAT_STREAM_MAX_QUEUE_BYTES,
  CHAT_STREAM_MAX_SNAPSHOT_ENVELOPE_BYTES,
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

  it("preserves the supported aggregate attachment size within bounded envelopes", () => {
    const maximumBase64Payload =
      4 * Math.ceil(MAX_CHAT_ATTACHMENTS_TOTAL_BYTES / 3);
    expect(CHAT_STREAM_MAX_DISPATCH_ENVELOPE_BYTES).toBeGreaterThan(
      maximumBase64Payload,
    );
    expect(CHAT_STREAM_MAX_QUEUE_BYTES).toBeGreaterThan(maximumBase64Payload);
    expect(CHAT_STREAM_MAX_SNAPSHOT_ENVELOPE_BYTES).toBeGreaterThan(
      CHAT_STREAM_MAX_QUEUE_BYTES,
    );
  });
});
