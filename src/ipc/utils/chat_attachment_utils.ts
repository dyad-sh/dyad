import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FilePart, ModelMessage } from "ai";

import {
  isLocalAgentBackedMode,
  type ChatMode,
  type UserSettings,
} from "@/lib/schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { MAX_AI_MESSAGES_SIZE } from "@/ipc/utils/ai_messages_utils";
import { isSandboxSupportedPlatform } from "@/ipc/utils/sandbox/runner";
import { isSandboxScriptExecutionEnabled } from "@/pro/main/ipc/handlers/local_agent/tools/execute_sandbox_script";
import {
  toAttachmentLogicalPath,
  type StoredAttachmentInfo,
} from "@/ipc/utils/media_path_utils";
import {
  describeSkippedArchiveEntries,
  type ExtractedArchiveSummary,
} from "@/ipc/utils/zip/zip_attachment";

export type StoredChatAttachment = StoredAttachmentInfo & {
  attachmentType: "upload-to-codebase" | "chat-context";
  /** Present when the attachment is a zip archive that was unpacked. */
  archive?: ExtractedArchiveSummary;
};

export type PendingStoredChatAttachment = Omit<
  StoredChatAttachment,
  "logicalName" | "originalName" | "storedFileName" | "mimeType" | "sizeBytes"
> & {
  attachmentType: "upload-to-codebase" | "chat-context";
};

export type AttachmentDeliveryConfig = {
  inlineTextAttachments: boolean;
  includeImageParts: boolean;
  useOnDiskAttachmentBlock: boolean;
  includeSandboxScriptHint: boolean;
  includeCopyFileHint: boolean;
  addSystemCopyInstructions: boolean;
  addSystemVisionInstructions: boolean;
};

const TEXT_FILE_EXTENSIONS = [
  ".md",
  ".txt",
  ".json",
  ".csv",
  ".js",
  ".ts",
  ".html",
  ".css",
];
const INLINE_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
]);

export function getInlineImageMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (!INLINE_IMAGE_EXTENSIONS.has(ext)) {
    return null;
  }
  return ext === ".jpg" ? "image/jpeg" : `image/${ext.slice(1)}`;
}

export function isInlineImageAttachmentPath(filePath: string): boolean {
  return getInlineImageMimeType(filePath) !== null;
}

export function isInlineImageAttachment(
  attachment: StoredChatAttachment,
): boolean {
  return isInlineImageAttachmentPath(attachment.filePath);
}

export function isPdfAttachmentPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".pdf";
}

/**
 * Chat-context PDFs are sent to the model as file parts. Uploads stay on disk
 * so the model can copy them into the codebase without paying to read them.
 */
export function isInlinePdfAttachment(
  attachment: Pick<StoredChatAttachment, "filePath" | "attachmentType">,
): boolean {
  return (
    attachment.attachmentType === "chat-context" &&
    isPdfAttachmentPath(attachment.filePath)
  );
}

/**
 * Read this turn's chat-context PDFs as file parts. Base64 strings (not
 * Buffers) keep the parts compact when persisted in aiMessagesJson.
 */
export async function buildInlinePdfFileParts(
  attachments: readonly Pick<
    StoredChatAttachment,
    "filePath" | "attachmentType" | "originalName"
  >[],
): Promise<FilePart[]> {
  const parts: FilePart[] = [];
  for (const attachment of attachments) {
    if (!isInlinePdfAttachment(attachment)) continue;
    const data = await readFile(attachment.filePath);
    parts.push({
      type: "file",
      data: data.toString("base64"),
      mediaType: "application/pdf",
      filename: attachment.originalName,
    });
  }
  return parts;
}

export const PDF_INPUT_UNSUPPORTED_MESSAGE =
  "This model can't read PDF attachments. Switch to a model that supports PDFs or start a new chat.";

/** Earlier turns replay their PDFs, so check the whole outgoing history. */
export function messagesContainPdf(messages: readonly ModelMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      Array.isArray(message.content) &&
      message.content.some(
        (part) => part.type === "file" && part.mediaType === "application/pdf",
      ),
  );
}

export const INLINE_ATTACHMENTS_TOO_LARGE_MESSAGE =
  "The images and PDFs in this message are too large to send together. Remove some attachments or send them in separate messages.";

// Room for the JSON envelope and message metadata around the inline parts.
const AI_MESSAGE_JSON_HEADROOM_CHARS = 64 * 1024;

/**
 * Inline images and PDFs are persisted base64-encoded in the user message's
 * aiMessagesJson. Past its size cap the structured message is not saved, and
 * inference would silently receive only the plain-text prompt, so reject the
 * turn before it is accepted instead.
 */
export function assertInlineAttachmentsFit(
  attachments: readonly Pick<
    StoredChatAttachment,
    "filePath" | "attachmentType" | "sizeBytes"
  >[],
  promptChars: number,
): void {
  const encodedChars = attachments
    .filter(isInlineAttachment)
    .reduce(
      (total, attachment) => total + 4 * Math.ceil(attachment.sizeBytes / 3),
      0,
    );
  if (
    encodedChars + promptChars + AI_MESSAGE_JSON_HEADROOM_CHARS >
    MAX_AI_MESSAGES_SIZE
  ) {
    throw new DyadError(
      INLINE_ATTACHMENTS_TOO_LARGE_MESSAGE,
      DyadErrorKind.Validation,
    );
  }
}

/** Whether a message carries inline image or file parts. */
export function hasInlineMediaParts(message: ModelMessage): boolean {
  return (
    message.role === "user" &&
    Array.isArray(message.content) &&
    message.content.some(
      (part) => part.type === "image" || part.type === "file",
    )
  );
}

function isInlineAttachment(
  attachment: Pick<StoredChatAttachment, "filePath" | "attachmentType">,
): boolean {
  return (
    isInlineImageAttachmentPath(attachment.filePath) ||
    isInlinePdfAttachment(attachment)
  );
}

export async function isTextFile(filePath: string): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_FILE_EXTENSIONS.includes(ext);
}

function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }
  return `${Math.round((sizeBytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Entries listed inline for an archive before the model must enumerate. */
export const MAX_ARCHIVE_ENTRIES_IN_PROMPT = 100;
/** Characters the inline entry list may occupy, so long paths stay bounded. */
export const MAX_ARCHIVE_LISTING_CHARS = 8 * 1024;

/**
 * Prompt lines describing an unpacked archive attachment: how it was
 * unpacked, how to reach its entries, and the entries themselves (up to a
 * cap). The caller supplies only the hints that apply to the current mode.
 */
export function buildArchiveAttachmentInfo(
  attachment: StoredChatAttachment & { archive: ExtractedArchiveSummary },
  hints: { includeSandboxScriptHint: boolean; includeCopyFileHint: boolean },
): string[] {
  const { archive } = attachment;
  const logicalPath = toAttachmentLogicalPath(attachment.logicalName);
  const fileCount = archive.files.length;
  const summaryParts = [
    `zip archive unpacked into ${fileCount} ${fileCount === 1 ? "file" : "files"} (${formatAttachmentSize(archive.totalBytes)})`,
  ];
  if (archive.strippedRootDir) {
    summaryParts.push(
      `its single top-level folder "${archive.strippedRootDir}" was unwrapped`,
    );
  }
  const skippedSummary = describeSkippedArchiveEntries(archive.skipped);
  if (skippedSummary) {
    summaryParts.push(skippedSummary);
  }
  const lines = [
    `- ${logicalPath} (${formatAttachmentSize(attachment.sizeBytes)}, ${attachment.mimeType}): ${summaryParts.join("; ")}.`,
  ];
  if (fileCount === 0) {
    lines.push("  Nothing was extracted, so there are no entries to read.");
    return lines;
  }

  const access = [
    `Read an entry with read_file using ${logicalPath}/<entry path>`,
  ];
  if (hints.includeSandboxScriptHint) {
    access.push(
      `or process many entries at once with execute_sandbox_script (list_files(${JSON.stringify(logicalPath)}) enumerates them)`,
    );
  }
  lines.push(`  ${access.join(", ")}.`);
  if (attachment.attachmentType === "upload-to-codebase") {
    lines.push(
      hints.includeCopyFileHint
        ? "  The user wants these files added to the project: copy each relevant entry into the right place with copy_file."
        : "  The user wants these files added to the project.",
    );
  } else {
    lines.push(
      "  Do not copy archive contents into the project unless the user asks for that.",
    );
  }

  lines.push("  Entries:");
  let listed = 0;
  let listingChars = 0;
  for (const file of archive.files) {
    const line = `    ${file.relativePath} (${formatAttachmentSize(file.sizeBytes)})`;
    if (
      listed >= MAX_ARCHIVE_ENTRIES_IN_PROMPT ||
      (listed > 0 && listingChars + line.length > MAX_ARCHIVE_LISTING_CHARS)
    ) {
      break;
    }
    lines.push(line);
    listed++;
    listingChars += line.length;
  }
  const remaining = fileCount - listed;
  if (remaining > 0) {
    lines.push(
      `    ...and ${remaining} more ${remaining === 1 ? "entry" : "entries"} not listed here; list_files with directory "${logicalPath}" lists up to 1000 of them, so narrow it to "${logicalPath}/<folder>" to see the rest.`,
    );
  }
  return lines;
}

function hasArchive(
  attachment: StoredChatAttachment,
): attachment is StoredChatAttachment & { archive: ExtractedArchiveSummary } {
  return attachment.archive !== undefined;
}

export function buildLocalAgentAttachmentInfo(
  attachments: StoredChatAttachment[],
  deliveryConfig: AttachmentDeliveryConfig,
): string {
  const diskAttachments = attachments.filter(
    (attachment) =>
      !isInlineAttachment(attachment) ||
      (deliveryConfig.includeCopyFileHint &&
        attachment.attachmentType === "upload-to-codebase"),
  );
  if (diskAttachments.length === 0) {
    return "";
  }

  const hasReadableAttachment = diskAttachments.some(
    (attachment) => !isInlineAttachment(attachment),
  );
  const lines = hasReadableAttachment
    ? deliveryConfig.includeSandboxScriptHint
      ? [
          "Attachments available on disk (use attachments:<name> with read_file / execute_sandbox_script):",
        ]
      : [
          "Attachments available on disk (use attachments:<name> with read_file):",
        ]
    : ["Attachments available on disk for copying into the codebase:"];

  for (const attachment of diskAttachments) {
    if (hasArchive(attachment)) {
      lines.push(...buildArchiveAttachmentInfo(attachment, deliveryConfig));
      continue;
    }
    const uploadNote =
      deliveryConfig.includeCopyFileHint &&
      attachment.attachmentType === "upload-to-codebase"
        ? "; if this should become part of the project, use copy_file from this attachment path"
        : "";
    lines.push(
      `- ${toAttachmentLogicalPath(attachment.logicalName)} (${formatAttachmentSize(attachment.sizeBytes)}, ${attachment.mimeType}${uploadNote})`,
    );
  }

  return `\n\n${lines.join("\n")}\n`;
}

/** Archives with no extracted files have nothing to read. */
export function hasScriptReadableAttachment(
  attachments: StoredChatAttachment[],
): boolean {
  return attachments.some(
    (attachment) =>
      !isInlineAttachment(attachment) &&
      !(attachment.archive && attachment.archive.files.length === 0),
  );
}

/**
 * An archive's entries are never inlined into the prompt, so even in modes
 * that inline attachments the model has to read them with a tool. Archives
 * with no extracted files have nothing to read.
 */
export function hasArchiveAttachment(
  attachments: StoredChatAttachment[],
): boolean {
  return attachments.some(
    (attachment) => (attachment.archive?.files.length ?? 0) > 0,
  );
}

export function resolveAttachmentDeliveryConfig({
  mode,
  settings,
  hasImageAttachments,
  hasUploadedAttachments,
}: {
  mode: ChatMode;
  settings: Pick<UserSettings, "enableSandboxScriptExecution">;
  hasImageAttachments: boolean;
  hasUploadedAttachments: boolean;
}): AttachmentDeliveryConfig {
  const willUseLocalAgentStream = isLocalAgentBackedMode(mode);
  const useOnDiskAttachmentBlock =
    mode === "build" || mode === "local-agent" || mode === "ask";

  return {
    inlineTextAttachments: !useOnDiskAttachmentBlock,
    includeImageParts: true,
    useOnDiskAttachmentBlock,
    includeSandboxScriptHint:
      mode !== "build" &&
      useOnDiskAttachmentBlock &&
      isSandboxScriptExecutionEnabled(settings) &&
      isSandboxSupportedPlatform(),
    includeCopyFileHint: mode === "build" || mode === "local-agent",
    addSystemCopyInstructions:
      !willUseLocalAgentStream && hasUploadedAttachments && mode !== "ask",
    addSystemVisionInstructions:
      hasImageAttachments &&
      (!willUseLocalAgentStream || mode === "plan") &&
      !(hasUploadedAttachments && mode !== "ask"),
  };
}
