import { describe, it, expect } from "vitest";
import {
  chatAttachmentToFileAttachment,
  fileAttachmentToChatAttachment,
} from "@/lib/attachment_conversion";
import type { ChatAttachment, FileAttachment } from "@/ipc/types";

describe("attachment_conversion", () => {
  it("round-trips a File through base64 and back preserving bytes and metadata", async () => {
    const originalBytes = new Uint8Array([0, 1, 2, 250, 128, 255]);
    const fileAttachment: FileAttachment = {
      file: new File([originalBytes], "blob.bin", {
        type: "application/octet-stream",
      }),
      type: "upload-to-codebase",
    };

    const chatAttachment = await fileAttachmentToChatAttachment(fileAttachment);
    expect(chatAttachment.name).toBe("blob.bin");
    expect(chatAttachment.type).toBe("application/octet-stream");
    expect(chatAttachment.attachmentType).toBe("upload-to-codebase");
    expect(chatAttachment.data.startsWith("data:")).toBe(true);

    const restored = chatAttachmentToFileAttachment(chatAttachment);
    expect(restored.type).toBe("upload-to-codebase");
    expect(restored.file.name).toBe("blob.bin");
    expect(restored.file.type).toBe("application/octet-stream");
    const restoredBytes = new Uint8Array(await restored.file.arrayBuffer());
    expect(Array.from(restoredBytes)).toEqual(Array.from(originalBytes));
  });

  it("decodes a bare base64 payload (no data-URL prefix)", () => {
    const attachment: ChatAttachment = {
      name: "a.txt",
      type: "text/plain",
      data: "aGVsbG8=", // "hello"
      attachmentType: "chat-context",
    };
    const restored = chatAttachmentToFileAttachment(attachment);
    expect(restored.type).toBe("chat-context");
    expect(restored.file.name).toBe("a.txt");
  });
});
