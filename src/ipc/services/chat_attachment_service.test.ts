import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import * as path from "path";

const telemetryMock = vi.hoisted(() => vi.fn());
vi.mock("../utils/telemetry", () => ({
  sendTelemetryEvent: telemetryMock,
}));

import {
  ChatAttachmentService,
  createAttachmentCollector,
  type AttachmentCollector,
} from "./chat_attachment_service";

describe("ChatAttachmentService", () => {
  const service = new ChatAttachmentService();
  let appPath: string;
  let collector: AttachmentCollector;

  beforeEach(() => {
    vi.clearAllMocks();
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), "attachment-test-"));
    collector = createAttachmentCollector();
  });

  afterEach(() => {
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  function makeAttachment(
    name: string,
    content: string,
    attachmentType: "upload-to-codebase" | "chat-context" = "chat-context",
    mimeType = "text/plain",
  ) {
    return {
      name,
      type: mimeType,
      data: `data:${mimeType};base64,${Buffer.from(content).toString("base64")}`,
      attachmentType,
    };
  }

  describe("persistIncomingAttachments", () => {
    it("returns empty info when there are no attachments", async () => {
      const result = await service.persistIncomingAttachments({
        attachments: [],
        appPath,
        appRelativePath: "my-app",
        appId: 1,
        chatId: 2,
        collector,
      });
      expect(result.attachmentInfo).toBe("");
      expect(result.displayAttachmentInfo).toBe("");
      expect(collector.attachmentPaths).toEqual([]);
    });

    it("persists files under .dyad/media with content-hashed names", async () => {
      await service.persistIncomingAttachments({
        attachments: [makeAttachment("notes.txt", "hello world")],
        appPath,
        appRelativePath: "my-app",
        appId: 1,
        chatId: 2,
        collector,
      });

      expect(collector.attachmentPaths).toHaveLength(1);
      const storedPath = collector.attachmentPaths[0];
      expect(storedPath).toContain(path.join(appPath, ".dyad", "media"));
      expect(fs.readFileSync(storedPath, "utf-8")).toBe("hello world");
      // Content-hashed filename keeps the original extension
      expect(path.extname(storedPath)).toBe(".txt");
      expect(collector.manifestEntries[0].originalName).toBe("notes.txt");
      expect(telemetryMock).toHaveBeenCalledWith(
        "attachment.stored",
        expect.objectContaining({ appId: 1, chatId: 2 }),
      );
    });

    it("builds display tags and upload instructions for upload-to-codebase files", async () => {
      const { attachmentInfo, displayAttachmentInfo } =
        await service.persistIncomingAttachments({
          attachments: [
            makeAttachment(
              "logo.png",
              "fake-image",
              "upload-to-codebase",
              "image/png",
            ),
          ],
          appPath,
          appRelativePath: "my-app",
          appId: 1,
          chatId: 2,
          collector,
        });

      expect(attachmentInfo).toContain("File to upload to codebase");
      expect(attachmentInfo).toContain("logo.png");
      expect(displayAttachmentInfo).toContain("<dyad-attachment");
      expect(displayAttachmentInfo).toContain("dyad-media://media/my-app/");
      expect(displayAttachmentInfo).toContain(
        'attachment-type="upload-to-codebase"',
      );
    });

    it("includes a text-attachment placeholder for chat-context text files", async () => {
      const { attachmentInfo } = await service.persistIncomingAttachments({
        attachments: [makeAttachment("notes.txt", "some text content")],
        appPath,
        appRelativePath: "my-app",
        appId: 1,
        chatId: 2,
        collector,
      });

      expect(attachmentInfo).toContain("- notes.txt (text/plain)");
      expect(attachmentInfo).toContain("<dyad-text-attachment");
    });
  });

  describe("finalizeStoredAttachments", () => {
    it("writes the manifest and returns stored attachments with file paths", async () => {
      await service.persistIncomingAttachments({
        attachments: [makeAttachment("notes.txt", "hello")],
        appPath,
        appRelativePath: "my-app",
        appId: 1,
        chatId: 2,
        collector,
      });

      const stored = await service.finalizeStoredAttachments({
        appPath,
        collector,
      });

      expect(stored).toHaveLength(1);
      expect(stored[0].filePath).toBe(collector.attachmentPaths[0]);
      expect(stored[0].attachmentType).toBe("chat-context");
      expect(stored[0].mimeType).toBe("text/plain");
    });
  });

  describe("prepareMessageWithAttachments", () => {
    it("inlines text attachment content into the message", async () => {
      const filePath = path.join(appPath, "data.txt");
      fs.writeFileSync(filePath, "file body");
      // Tag as built by persistIncomingAttachments (path is XML-escaped)
      const message = {
        role: "user" as const,
        content: `check this <dyad-text-attachment filename="data.txt" type="text/plain" path="${filePath}">
                </dyad-text-attachment>`,
      };

      const prepared = await service.prepareMessageWithAttachments(
        message,
        [filePath],
        { includeImageAttachments: true, inlineTextAttachments: true },
      );

      expect(Array.isArray(prepared.content)).toBe(true);
      const textPart = (prepared.content as any[])[0];
      expect(textPart.type).toBe("text");
      expect(textPart.text).toContain("Full content of data.txt");
      expect(textPart.text).toContain("file body");
      expect(textPart.text).not.toContain("<dyad-text-attachment");
    });

    it("adds base64 image parts for image attachments", async () => {
      const filePath = path.join(appPath, "pic.png");
      fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const message = { role: "user" as const, content: "look at this" };

      const prepared = await service.prepareMessageWithAttachments(
        message,
        [filePath],
        { includeImageAttachments: true, inlineTextAttachments: false },
      );

      const parts = prepared.content as any[];
      expect(parts).toHaveLength(2);
      expect(parts[1].type).toBe("image");
      expect(parts[1].mediaType).toBe("image/png");
      expect(typeof parts[1].image).toBe("string");
    });

    it("skips image parts when includeImageAttachments is false", async () => {
      const filePath = path.join(appPath, "pic.png");
      fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const message = { role: "user" as const, content: "look" };

      const prepared = await service.prepareMessageWithAttachments(
        message,
        [filePath],
        { includeImageAttachments: false, inlineTextAttachments: false },
      );

      expect(prepared.content as any[]).toHaveLength(1);
    });
  });
});
