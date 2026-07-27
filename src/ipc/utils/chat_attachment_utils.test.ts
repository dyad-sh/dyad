import { describe, expect, it } from "vitest";

import {
  hasDescribableImageAttachment,
  resolveAttachmentDeliveryConfig,
  type StoredChatAttachment,
} from "@/ipc/utils/chat_attachment_utils";

const settings = { enableSandboxScriptExecution: false };

function resolve(
  overrides: Partial<
    Parameters<typeof resolveAttachmentDeliveryConfig>[0]
  > = {},
) {
  return resolveAttachmentDeliveryConfig({
    mode: "build",
    settings,
    hasImageAttachments: false,
    hasUploadedAttachments: false,
    ...overrides,
  });
}

function attachment(
  overrides: Partial<StoredChatAttachment> = {},
): StoredChatAttachment {
  return {
    logicalName: "mockup.png",
    originalName: "mockup.png",
    storedFileName: "abc123.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    filePath: "/media/abc123.png",
    attachmentType: "chat-context",
    ...overrides,
  };
}

describe("hasDescribableImageAttachment", () => {
  it("is true for a chat-context image", () => {
    expect(hasDescribableImageAttachment([attachment()])).toBe(true);
  });

  it("is false for an upload-to-codebase image", () => {
    // A project asset bound for <dyad-copy>; the model losing sight of it costs
    // nothing, so it must not trigger the "switch models" note.
    expect(
      hasDescribableImageAttachment([
        attachment({ attachmentType: "upload-to-codebase" }),
      ]),
    ).toBe(false);
  });

  it("is false for a non-image chat-context attachment", () => {
    expect(
      hasDescribableImageAttachment([
        attachment({ mimeType: "text/plain", filePath: "/media/notes.txt" }),
      ]),
    ).toBe(false);
  });

  it("is true for an image type we cannot inline, since the user still wanted it seen", () => {
    // .svg has an image/* mime but is not in INLINE_IMAGE_EXTENSIONS, so the
    // describer will decline it — the note is still the right outcome.
    expect(
      hasDescribableImageAttachment([
        attachment({ mimeType: "image/svg+xml", filePath: "/media/icon.svg" }),
      ]),
    ).toBe(true);
  });

  it("is true when a chat-context image sits alongside an upload", () => {
    expect(
      hasDescribableImageAttachment([
        attachment({ attachmentType: "upload-to-codebase" }),
        attachment({ filePath: "/media/screenshot.png" }),
      ]),
    ).toBe(true);
  });

  it("is false for no attachments", () => {
    expect(hasDescribableImageAttachment([])).toBe(false);
  });
});

describe("resolveAttachmentDeliveryConfig", () => {
  describe("modelSupportsVision", () => {
    it("includes image parts by default so unclassified models are unchanged", () => {
      expect(resolve({ hasImageAttachments: true }).includeImageParts).toBe(
        true,
      );
    });

    it("drops image parts when the model does not support vision", () => {
      expect(
        resolve({ hasImageAttachments: true, modelSupportsVision: false })
          .includeImageParts,
      ).toBe(false);
    });

    it("keeps image parts when the model supports vision", () => {
      expect(
        resolve({ hasImageAttachments: true, modelSupportsVision: true })
          .includeImageParts,
      ).toBe(true);
    });
  });

  describe("addSystemVisionInstructions", () => {
    it("is set for a vision-capable model with image attachments", () => {
      expect(
        resolve({ hasImageAttachments: true, modelSupportsVision: true })
          .addSystemVisionInstructions,
      ).toBe(true);
    });

    it("is cleared when no image part is actually sent", () => {
      expect(
        resolve({ hasImageAttachments: true, modelSupportsVision: false })
          .addSystemVisionInstructions,
      ).toBe(false);
    });
  });

  it("does not change the other delivery flags", () => {
    const capable = resolve({
      hasImageAttachments: true,
      modelSupportsVision: true,
    });
    const incapable = resolve({
      hasImageAttachments: true,
      modelSupportsVision: false,
    });

    expect(incapable.inlineTextAttachments).toBe(capable.inlineTextAttachments);
    expect(incapable.useOnDiskAttachmentBlock).toBe(
      capable.useOnDiskAttachmentBlock,
    );
    expect(incapable.includeCopyFileHint).toBe(capable.includeCopyFileHint);
    expect(incapable.addSystemCopyInstructions).toBe(
      capable.addSystemCopyInstructions,
    );
  });

  it("leaves turns without images unaffected by the vision flag", () => {
    const config = resolve({ modelSupportsVision: false });

    expect(config.addSystemVisionInstructions).toBe(false);
    expect(config.inlineTextAttachments).toBe(true);
  });
});
