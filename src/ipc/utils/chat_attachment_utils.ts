import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FilePart, ModelMessage } from "ai";

import {
  isLocalAgentBackedMode,
  type ChatMode,
  type UserSettings,
} from "@/lib/schemas";
import { isSandboxSupportedPlatform } from "@/ipc/utils/sandbox/runner";
import { isSandboxScriptExecutionEnabled } from "@/pro/main/ipc/handlers/local_agent/tools/execute_sandbox_script";
import {
  toAttachmentLogicalPath,
  type StoredAttachmentInfo,
} from "@/ipc/utils/media_path_utils";

export type StoredChatAttachment = StoredAttachmentInfo & {
  attachmentType: "upload-to-codebase" | "chat-context";
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

function isInlineAttachment(attachment: StoredChatAttachment): boolean {
  return (
    isInlineImageAttachment(attachment) || isInlinePdfAttachment(attachment)
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

export function hasScriptReadableAttachment(
  attachments: StoredChatAttachment[],
): boolean {
  return attachments.some((attachment) => !isInlineAttachment(attachment));
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
