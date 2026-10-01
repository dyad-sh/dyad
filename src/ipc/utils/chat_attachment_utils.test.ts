import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertInlineAttachmentsFit,
  buildInlinePdfFileParts,
  buildLocalAgentAttachmentInfo,
  hasScriptReadableAttachment,
  messagesContainPdf,
  resolveAttachmentDeliveryConfig,
  type StoredChatAttachment,
} from "./chat_attachment_utils";

describe("resolveAttachmentDeliveryConfig", () => {
  it("uses on-disk read/copy attachments without sandbox hints in Build", () => {
    expect(
      resolveAttachmentDeliveryConfig({
        mode: "build",
        settings: { enableSandboxScriptExecution: true },
        hasImageAttachments: true,
        hasUploadedAttachments: true,
      }),
    ).toMatchObject({
      inlineTextAttachments: false,
      useOnDiskAttachmentBlock: true,
      includeSandboxScriptHint: false,
      includeCopyFileHint: true,
      addSystemCopyInstructions: false,
    });
  });
});

describe("PDF attachments", () => {
  let dir: string;
  const pdfBytes = Buffer.from("%PDF-1.4\n%fake\n");

  function attachment(
    fileName: string,
    attachmentType: StoredChatAttachment["attachmentType"],
    mimeType = "application/pdf",
  ): StoredChatAttachment {
    return {
      logicalName: fileName,
      originalName: fileName,
      storedFileName: fileName,
      mimeType,
      sizeBytes: pdfBytes.byteLength,
      filePath: path.join(dir, fileName),
      attachmentType,
    };
  }

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pdf-attach-"));
    for (const name of ["spec.pdf", "menu.pdf"]) {
      await fs.promises.writeFile(path.join(dir, name), pdfBytes);
    }
  });

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it("builds file parts for chat-context PDFs only", async () => {
    const parts = await buildInlinePdfFileParts([
      attachment("spec.pdf", "chat-context"),
      attachment("menu.pdf", "upload-to-codebase"),
      attachment("notes.txt", "chat-context", "text/plain"),
    ]);

    expect(parts).toEqual([
      {
        type: "file",
        data: pdfBytes.toString("base64"),
        mediaType: "application/pdf",
        filename: "spec.pdf",
      },
    ]);
  });

  it("keeps inline PDFs out of the on-disk attachment list", () => {
    const config = resolveAttachmentDeliveryConfig({
      mode: "local-agent",
      settings: { enableSandboxScriptExecution: false },
      hasImageAttachments: false,
      hasUploadedAttachments: true,
    });
    const info = buildLocalAgentAttachmentInfo(
      [
        attachment("spec.pdf", "chat-context"),
        attachment("menu.pdf", "upload-to-codebase"),
      ],
      config,
    );

    expect(info).not.toContain("attachments:spec.pdf");
    expect(info).toContain("attachments:menu.pdf");
    expect(
      hasScriptReadableAttachment([attachment("spec.pdf", "chat-context")]),
    ).toBe(false);
  });

  it("detects PDFs anywhere in the outgoing history", () => {
    const pdfTurn = {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "summarize" },
        {
          type: "file" as const,
          data: "JVBERi0=",
          mediaType: "application/pdf",
        },
      ],
    };

    expect(
      messagesContainPdf([
        pdfTurn,
        { role: "assistant", content: "done" },
        { role: "user", content: "now something else" },
      ]),
    ).toBe(true);
    expect(
      messagesContainPdf([
        { role: "user", content: "hello" },
        {
          role: "user",
          content: [{ type: "image", image: "aGk=", mediaType: "image/png" }],
        },
      ]),
    ).toBe(false);
  });
});

describe("assertInlineAttachmentsFit", () => {
  const MIB = 1024 * 1024;
  const inline = (
    fileName: string,
    sizeBytes: number,
    attachmentType: StoredChatAttachment["attachmentType"] = "chat-context",
  ) => ({ filePath: `/media/${fileName}`, attachmentType, sizeBytes });

  it("rejects inline attachments that would exceed the aiMessagesJson cap", () => {
    // Each PDF passes the per-file cap, but together they encode to ~11 MB.
    expect(() =>
      assertInlineAttachmentsFit(
        [inline("a.pdf", 4 * MIB), inline("b.pdf", 4 * MIB)],
        10,
      ),
    ).toThrow("too large to send together");
    expect(() =>
      assertInlineAttachmentsFit(
        [inline("a.pdf", 4 * MIB), inline("photo.png", 4 * MIB)],
        10,
      ),
    ).toThrow("too large to send together");
  });

  it("accepts inline attachments within the cap", () => {
    expect(() =>
      assertInlineAttachmentsFit([inline("a.pdf", 4 * MIB)], 10),
    ).not.toThrow();
  });

  it("counts the prompt toward the cap", () => {
    expect(() =>
      assertInlineAttachmentsFit([inline("a.pdf", 5 * MIB)], 3_000_000),
    ).toThrow("too large to send together");
  });

  it("ignores attachments that stay on disk", () => {
    expect(() =>
      assertInlineAttachmentsFit(
        [
          inline("a.pdf", 4 * MIB),
          inline("b.pdf", 4 * MIB, "upload-to-codebase"),
          inline("data.csv", 8 * MIB),
        ],
        10,
      ),
    ).not.toThrow();
  });
});
