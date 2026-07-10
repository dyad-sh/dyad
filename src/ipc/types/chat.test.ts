import { describe, expect, it } from "vitest";

import {
  CHAT_ATTACHMENT_COUNT_LIMIT_MESSAGE,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENT_DATA_URL_CHARS,
} from "../../shared/chatAttachmentLimits";
import { ChatAttachmentSchema, ChatStreamParamsSchema } from "./chat";

const validAttachment = {
  name: "notes.txt",
  type: "text/plain",
  data: "data:text/plain;base64,SGVsbG8=",
  attachmentType: "chat-context" as const,
};

describe("ChatStreamParamsSchema attachment limits", () => {
  it("accepts valid base64 attachment input", () => {
    expect(
      ChatStreamParamsSchema.safeParse({
        chatId: 1,
        prompt: "hello",
        attachments: [validAttachment],
      }).success,
    ).toBe(true);
  });

  it("rejects too many attachments", () => {
    const result = ChatStreamParamsSchema.safeParse({
      chatId: 1,
      prompt: "hello",
      attachments: Array.from(
        { length: MAX_CHAT_ATTACHMENTS + 1 },
        () => validAttachment,
      ),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        CHAT_ATTACHMENT_COUNT_LIMIT_MESSAGE,
      );
    }
  });

  it("rejects excessive counts before reading attachment payloads", () => {
    const unreadAttachment = new Proxy(
      {},
      {
        get() {
          throw new Error("attachment payload should not be read");
        },
      },
    );

    const result = ChatStreamParamsSchema.safeParse({
      chatId: 1,
      prompt: "hello",
      attachments: Array.from(
        { length: MAX_CHAT_ATTACHMENTS + 1 },
        () => unreadAttachment,
      ),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        CHAT_ATTACHMENT_COUNT_LIMIT_MESSAGE,
      );
    }
  });

  it("uses an attachment-specific message for oversized serialized data", () => {
    const result = ChatAttachmentSchema.safeParse({
      ...validAttachment,
      name: "oversized.bin",
      data: "A".repeat(MAX_CHAT_ATTACHMENT_DATA_URL_CHARS + 1),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        '"oversized.bin" exceeds the 10 MiB attachment limit.',
      );
    }
  });

  it("rejects attachments without a base64 data URL prefix", () => {
    expect(
      ChatStreamParamsSchema.safeParse({
        chatId: 1,
        prompt: "hello",
        attachments: [{ ...validAttachment, data: "SGVsbG8=" }],
      }).success,
    ).toBe(false);
  });
});
