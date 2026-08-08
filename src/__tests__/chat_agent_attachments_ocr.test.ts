import { beforeEach, describe, expect, it, vi } from "vitest";

const extractDocumentText = vi.fn();
vi.mock("@/ipc/types", () => ({
  ipc: { ocr: { extractDocumentText } },
}));

const {
  buildChatAgentMessageWithAttachments,
  prepareChatAgentMessage,
  DOCUMENT_READING_TIMEOUT_MS,
} = await import("@/lib/chat_agent_attachments");

function pdf(name = "Invoice-0018.pdf") {
  return {
    type: "chat-context" as const,
    file: new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, {
      type: "application/pdf",
    }),
  };
}

beforeEach(() => {
  extractDocumentText.mockReset();
});

describe("PDF attachments go through OCR", () => {
  it("inlines the extracted text so the model can actually read it", async () => {
    extractDocumentText.mockResolvedValue({
      text: "Invoice total: $420.00",
      model: "google/gemini-3-flash",
    });

    const message = await buildChatAgentMessageWithAttachments(
      "What is the total on this invoice?",
      [pdf()],
    );

    expect(extractDocumentText).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "Invoice-0018.pdf",
        mimeType: "application/pdf",
        dataBase64: expect.any(String),
      }),
    );
    expect(message).toContain("Invoice total: $420.00");
    expect(message).toContain("Contents of Invoice-0018.pdf");
    expect(message).not.toContain("[Attached file:");
  });

  it("keeps the extracted text out of the visible bubble", async () => {
    extractDocumentText.mockResolvedValue({
      text: "Page one of a very long brochure…",
      model: "vision",
    });

    const prepared = await prepareChatAgentMessage("Summarise this", [pdf()]);

    // The model gets the contents; the bubble shows the question asked.
    expect(prepared.modelText).toContain("Page one of a very long brochure");
    expect(prepared.displayText).toBe("Summarise this");
  });

  it("names the file when the prompt is empty", async () => {
    extractDocumentText.mockResolvedValue({ text: "text", model: "vision" });
    const prepared = await prepareChatAgentMessage("", [pdf()]);
    expect(prepared.displayText).toBe("Invoice-0018.pdf");
  });

  it("carries the failure reason in the message instead of a bare filename", async () => {
    extractDocumentText.mockRejectedValue(
      new Error("No OCR model is assigned."),
    );

    const message = await buildChatAgentMessageWithAttachments("Read this", [
      pdf(),
    ]);

    expect(message).toContain("not read: No OCR model is assigned.");
  });

  it("stops waiting when the OCR IPC request never settles", async () => {
    vi.useFakeTimers();
    try {
      extractDocumentText.mockReturnValue(new Promise(() => {}));
      const pending = prepareChatAgentMessage("Read this", [pdf()]);

      await vi.advanceTimersByTimeAsync(DOCUMENT_READING_TIMEOUT_MS);

      const prepared = await pending;
      expect(prepared.modelText).toContain("Document reading took too long");
      expect(prepared.attachmentErrors).toEqual([
        expect.stringContaining("Document reading took too long"),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recognises a PDF by extension when the browser reports no type", async () => {
    extractDocumentText.mockResolvedValue({ text: "content", model: "m" });
    const noType = {
      type: "chat-context" as const,
      file: new File([new Uint8Array([1])], "scan.PDF", { type: "" }),
    };

    await buildChatAgentMessageWithAttachments("read", [noType]);

    expect(extractDocumentText).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "application/pdf" }),
    );
  });

  it("leaves text files and images on their existing paths", async () => {
    const text = {
      type: "chat-context" as const,
      file: new File(["hello"], "notes.txt", { type: "text/plain" }),
    };
    const image = {
      type: "chat-context" as const,
      file: new File([new Uint8Array([1])], "shot.png", { type: "image/png" }),
    };

    const message = await buildChatAgentMessageWithAttachments("see", [
      text,
      image,
    ]);

    expect(extractDocumentText).not.toHaveBeenCalled();
    expect(message).toContain("--- notes.txt ---\nhello");
    expect(message).toContain("[Attached image: shot.png]");
  });
});
