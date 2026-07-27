import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_ATTACHMENTS_TOTAL_BYTES,
  MAX_CHAT_ERROR_CHARS,
  MAX_CHAT_PROMPT_CHARS,
} from "@/shared/chatAttachmentLimits";
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
    payloadHash: "a".repeat(64),
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

  it("bounds renderer-controlled strings inside the enlarged envelope", () => {
    expect(
      SerializableChatTurnIntentSchema.safeParse({
        ...intent,
        prompt: "x".repeat(MAX_CHAT_PROMPT_CHARS + 1),
      }).success,
    ).toBe(false);
    expect(
      ChatStreamIntentEventSchema.safeParse({
        type: "REPORT_ERROR",
        error: "x".repeat(MAX_CHAT_ERROR_CHARS + 1),
      }).success,
    ).toBe(false);
  });
});
