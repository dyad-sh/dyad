import { describe, expect, it } from "vitest";
import {
  buildChatAgentMessageWithAttachments,
  getFirstImageAttachmentDataUrl,
} from "./chat_agent_attachments";
import type { FileAttachment } from "@/ipc/types";

describe("buildChatAgentMessageWithAttachments", () => {
  it("returns plain text when there are no attachments", async () => {
    expect(await buildChatAgentMessageWithAttachments("  hello  ", [])).toBe(
      "hello",
    );
  });

  it("appends image and text file sections", async () => {
    const attachments: FileAttachment[] = [
      {
        file: new File(["pixels"], "shot.png", { type: "image/png" }),
        type: "chat-context",
      },
      {
        file: new File(["line one"], "notes.txt", { type: "text/plain" }),
        type: "chat-context",
      },
    ];

    const result = await buildChatAgentMessageWithAttachments(
      "Summarize this",
      attachments,
    );

    expect(result).toContain("Summarize this");
    expect(result).toContain("[Attached image: shot.png]");
    expect(result).toContain("--- notes.txt ---");
    expect(result).toContain("line one");
  });

  it("builds message from attachments only", async () => {
    const attachments: FileAttachment[] = [
      {
        file: new File(["data"], "readme.md", { type: "text/markdown" }),
        type: "chat-context",
      },
    ];

    const result = await buildChatAgentMessageWithAttachments("", attachments);

    expect(result).toContain("--- readme.md ---");
    expect(result).toContain("data");
  });

  it("provides an attached image to image-to-video generation", async () => {
    const attachments: FileAttachment[] = [
      {
        file: new File(["pixels"], "shot.png", { type: "image/png" }),
        type: "chat-context",
      },
    ];

    await expect(getFirstImageAttachmentDataUrl(attachments)).resolves.toMatch(
      /^data:image\/png;base64,/,
    );
  });
});
