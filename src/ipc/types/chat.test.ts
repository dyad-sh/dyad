import { describe, expect, it } from "vitest";

import { MAX_CHAT_ATTACHMENTS } from "../../shared/chatAttachmentLimits";
import { ChatStreamParamsSchema } from "./chat";

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
    expect(
      ChatStreamParamsSchema.safeParse({
        chatId: 1,
        prompt: "hello",
        attachments: Array.from(
          { length: MAX_CHAT_ATTACHMENTS + 1 },
          () => validAttachment,
        ),
      }).success,
    ).toBe(false);
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
