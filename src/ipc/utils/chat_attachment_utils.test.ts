import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertInlineAttachmentsFit,
  buildInlinePdfFileParts,
  buildLocalAgentAttachmentInfo,
  hasArchiveAttachment,
  hasScriptReadableAttachment,
  MAX_ARCHIVE_ENTRIES_IN_PROMPT,
  MAX_ARCHIVE_LISTING_CHARS,
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

describe("archive attachments", () => {
  function archiveAttachment(
    overrides: Partial<StoredChatAttachment> = {},
  ): StoredChatAttachment {
    return {
      logicalName: "proj.zip",
      originalName: "proj.zip",
      storedFileName: "hash.zip",
      mimeType: "application/zip",
      sizeBytes: 2048,
      filePath: "/apps/demo/.dyad/media/hash.zip",
      attachmentType: "chat-context",
      archive: {
        extractedDirName: "hash",
        files: [
          { relativePath: "README.md", sizeBytes: 18 },
          { relativePath: "src/index.ts", sizeBytes: 26 },
        ],
        skipped: { ignored: 2, encrypted: 1 },
        strippedRootDir: "proj",
        totalBytes: 44,
        entryCount: 2,
      },
      ...overrides,
    };
  }

  it("describes the archive, its entries and how to read them", () => {
    const text = buildLocalAgentAttachmentInfo(
      [archiveAttachment()],
      resolveAttachmentDeliveryConfig({
        mode: "local-agent",
        settings: { enableSandboxScriptExecution: false },
        hasImageAttachments: false,
        hasUploadedAttachments: false,
      }),
    );
    expect(text).toContain(
      '- attachments:proj.zip (2 KB, application/zip): zip archive unpacked into 2 files (44 B); its single top-level folder "proj" was unwrapped; 3 entries skipped (1 encrypted, 2 packaging noise such as node_modules or __MACOSX).',
    );
    expect(text).toContain(
      "Read an entry with read_file using attachments:proj.zip/<entry path>.",
    );
    expect(text).not.toContain("execute_sandbox_script");
    expect(text).toContain(
      "Do not copy archive contents into the project unless the user asks for that.",
    );
    expect(text).toContain("    README.md (18 B)");
    expect(text).toContain("    src/index.ts (26 B)");
  });

  it("treats only archives as needing a tool read in inline modes", () => {
    expect(hasArchiveAttachment([archiveAttachment()])).toBe(true);
    expect(
      hasArchiveAttachment([archiveAttachment({ archive: undefined })]),
    ).toBe(false);
    const emptyArchive = archiveAttachment();
    emptyArchive.archive!.files = [];
    expect(hasArchiveAttachment([emptyArchive])).toBe(false);
    expect(hasScriptReadableAttachment([archiveAttachment()])).toBe(true);
    expect(hasScriptReadableAttachment([emptyArchive])).toBe(false);
  });

  it("adds the sandbox hint and the upload instruction when they apply", () => {
    const text = buildLocalAgentAttachmentInfo(
      [archiveAttachment({ attachmentType: "upload-to-codebase" })],
      {
        ...resolveAttachmentDeliveryConfig({
          mode: "local-agent",
          settings: { enableSandboxScriptExecution: true },
          hasImageAttachments: false,
          hasUploadedAttachments: true,
        }),
        includeSandboxScriptHint: true,
      },
    );
    expect(text).toContain(
      'or process many entries at once with execute_sandbox_script (list_files("attachments:proj.zip") enumerates them).',
    );
    expect(text).toContain(
      "The user wants these files added to the project: copy each relevant entry into the right place with copy_file.",
    );
    expect(text).not.toContain("Do not copy archive contents");
  });

  it("asks for the files without naming copy_file when the mode cannot copy", () => {
    const text = buildLocalAgentAttachmentInfo(
      [archiveAttachment({ attachmentType: "upload-to-codebase" })],
      {
        ...resolveAttachmentDeliveryConfig({
          mode: "plan",
          settings: { enableSandboxScriptExecution: false },
          hasImageAttachments: false,
          hasUploadedAttachments: true,
        }),
        useOnDiskAttachmentBlock: true,
      },
    );
    expect(text).toContain(
      "  The user wants these files added to the project.",
    );
    expect(text).not.toContain("copy_file");
    expect(text).not.toContain("Do not copy archive contents");
  });

  it("quotes the archive name in the sandbox hint", () => {
    const text = buildLocalAgentAttachmentInfo(
      [archiveAttachment({ logicalName: 'my"proj.zip' })],
      {
        ...resolveAttachmentDeliveryConfig({
          mode: "local-agent",
          settings: { enableSandboxScriptExecution: true },
          hasImageAttachments: false,
          hasUploadedAttachments: false,
        }),
        includeSandboxScriptHint: true,
      },
    );
    expect(text).toContain('list_files("attachments:my\\"proj.zip")');
  });

  it("says when an archive has nothing to read", () => {
    const text = buildLocalAgentAttachmentInfo(
      [
        archiveAttachment({
          archive: {
            extractedDirName: "hash",
            files: [],
            skipped: { encrypted: 2 },
            strippedRootDir: null,
            totalBytes: 0,
            entryCount: 0,
          },
        }),
      ],
      resolveAttachmentDeliveryConfig({
        mode: "local-agent",
        settings: { enableSandboxScriptExecution: false },
        hasImageAttachments: false,
        hasUploadedAttachments: false,
      }),
    );
    expect(text).toContain(
      "  Nothing was extracted, so there are no entries to read.",
    );
    expect(text).not.toContain("Read an entry");
    expect(text).not.toContain("Entries:");
  });

  it("caps the inline entry list", () => {
    const files = Array.from(
      { length: MAX_ARCHIVE_ENTRIES_IN_PROMPT + 5 },
      (_, i) => ({
        relativePath: `f${i}.txt`,
        sizeBytes: 1,
      }),
    );
    const text = buildLocalAgentAttachmentInfo(
      [
        archiveAttachment({
          archive: {
            extractedDirName: "hash",
            files,
            skipped: {},
            strippedRootDir: null,
            totalBytes: files.length,
            entryCount: files.length,
          },
        }),
      ],
      resolveAttachmentDeliveryConfig({
        mode: "local-agent",
        settings: { enableSandboxScriptExecution: false },
        hasImageAttachments: false,
        hasUploadedAttachments: false,
      }),
    );
    expect(text).toContain(
      `    f${MAX_ARCHIVE_ENTRIES_IN_PROMPT - 1}.txt (1 B)`,
    );
    expect(text).not.toContain(`    f${MAX_ARCHIVE_ENTRIES_IN_PROMPT}.txt`);
    expect(text).toContain(
      '    ...and 5 more entries not listed here; list_files with directory "attachments:proj.zip" lists up to 1000 of them, so narrow it to "attachments:proj.zip/<folder>" to see the rest.',
    );
    expect(text).not.toContain("was unwrapped");
    expect(text).not.toContain("skipped");
  });

  it("caps the inline entry list by characters as well", () => {
    const longName = "deeply/" + "nested/".repeat(30) + "x".repeat(200) + ".ts";
    const files = Array.from({ length: 50 }, (_, i) => ({
      relativePath: `${i}-${longName}`,
      sizeBytes: 1,
    }));
    const text = buildLocalAgentAttachmentInfo(
      [
        archiveAttachment({
          archive: {
            extractedDirName: "hash",
            files,
            skipped: {},
            strippedRootDir: null,
            totalBytes: files.length,
            entryCount: files.length,
          },
        }),
      ],
      resolveAttachmentDeliveryConfig({
        mode: "local-agent",
        settings: { enableSandboxScriptExecution: false },
        hasImageAttachments: false,
        hasUploadedAttachments: false,
      }),
    );
    const listed = text
      .split("\n")
      .filter((line) => line.startsWith("    ") && line.includes(longName));
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length).toBeLessThan(files.length);
    expect(listed.join("\n").length).toBeLessThanOrEqual(
      MAX_ARCHIVE_LISTING_CHARS,
    );
    expect(text).toContain(
      `...and ${files.length - listed.length} more entries not listed here`,
    );
  });
});
