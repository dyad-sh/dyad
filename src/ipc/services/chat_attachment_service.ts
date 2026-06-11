import fs from "node:fs";
import * as path from "path";
import * as crypto from "crypto";
import { readFile, writeFile } from "fs/promises";
import log from "electron-log";
import type { ModelMessage, TextPart, ImagePart } from "ai";
import { buildDyadMediaUrl } from "@/lib/dyadMediaUrl";
import { escapeXmlAttr } from "../../../shared/xmlEscape";
import {
  parseMediaMentions,
  stripResolvedMediaMentions,
} from "@/shared/parse_media_mentions";
import { resolveMediaMentions } from "../utils/resolve_media_mentions";
import { ensureDyadGitignored } from "../handlers/gitignoreUtils";
import { sendTelemetryEvent } from "../utils/telemetry";
import {
  appendAttachmentManifestEntriesWithLogicalNames,
  createUniqueAttachmentLogicalName,
  DYAD_MEDIA_DIR_NAME,
  type AttachmentManifestEntryInput,
} from "../utils/media_path_utils";
import {
  getInlineImageMimeType,
  isTextFile,
  type PendingStoredChatAttachment,
  type StoredChatAttachment,
} from "../utils/chat_attachment_utils";

const logger = log.scope("chat_attachment_service");

export interface ChatAttachmentInput {
  name: string;
  type: string;
  data: string;
  attachmentType: "upload-to-codebase" | "chat-context";
}

/**
 * Mutable collector threaded through attachment processing for one request.
 * Incoming uploads and resolved @media: mentions both contribute entries.
 */
export interface AttachmentCollector {
  attachmentPaths: string[];
  pendingStoredAttachments: PendingStoredChatAttachment[];
  manifestEntries: AttachmentManifestEntryInput[];
  usedLogicalNames: Set<string>;
}

export function createAttachmentCollector(): AttachmentCollector {
  return {
    attachmentPaths: [],
    pendingStoredAttachments: [],
    manifestEntries: [],
    usedLogicalNames: new Set<string>(),
  };
}

/**
 * Handles persistence and prompt/message integration of chat attachments
 * (Phase 2 extraction from chat_stream_handlers.ts):
 *
 * - persists uploads under the app's .dyad/media dir (content-hashed names)
 * - resolves @media: mentions to stored files
 * - finalizes the attachment manifest
 * - converts the last user message into multi-part content (inlined text
 *   files, base64 image parts)
 */
export class ChatAttachmentService {
  /**
   * Persists incoming attachments to `.dyad/media` and builds both the
   * AI-facing attachment instructions and the display-facing
   * `<dyad-attachment>` tags.
   */
  async persistIncomingAttachments({
    attachments,
    appPath,
    appRelativePath,
    appId,
    chatId,
    collector,
  }: {
    attachments: ChatAttachmentInput[];
    appPath: string;
    /** The app's path as stored in the db (used in dyad-media:// URLs). */
    appRelativePath: string;
    appId: number;
    chatId: number;
    collector: AttachmentCollector;
  }): Promise<{ attachmentInfo: string; displayAttachmentInfo: string }> {
    let attachmentInfo = "";
    let displayAttachmentInfo = "";

    if (attachments.length === 0) {
      return { attachmentInfo, displayAttachmentInfo };
    }

    attachmentInfo = "\n\nAttachments:\n";

    // Create persistent .dyad/media directory for this app
    const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }
    await ensureDyadGitignored(appPath);

    for (const attachment of attachments) {
      // Extract the base64 data (remove the data:mime/type;base64, prefix)
      const base64Data = attachment.data.split(";base64,").pop() || "";
      const fileBuffer = Buffer.from(base64Data, "base64");
      const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
      const fileExtension = path.extname(attachment.name);
      const filename = `${hash}${fileExtension}`;
      const logicalName = createUniqueAttachmentLogicalName(
        attachment.name,
        collector.usedLogicalNames,
      );

      // Save to .dyad/media dir
      const persistentPath = path.join(mediaDir, filename);
      await writeFile(persistentPath, fileBuffer);
      collector.attachmentPaths.push(persistentPath);
      collector.pendingStoredAttachments.push({
        filePath: persistentPath,
        attachmentType: attachment.attachmentType,
      });
      collector.manifestEntries.push({
        requestedLogicalName: logicalName,
        originalName: attachment.name,
        storedFileName: filename,
        mimeType: attachment.type,
        sizeBytes: fileBuffer.byteLength,
        createdAt: new Date().toISOString(),
      });
      sendTelemetryEvent("attachment.stored", {
        appId,
        chatId,
        attachmentType: attachment.attachmentType,
        mimeType: attachment.type,
        sizeBytes: fileBuffer.byteLength,
      });

      // Build dyad-media:// URL for display
      // Use a fixed hostname to avoid URL hostname normalization (lowercasing)
      // Encode path segments so special characters (spaces, #, ?, %) don't
      // break URL parsing. The protocol handler already decodeURIComponent's.
      const mediaUrl = `dyad-media://media/${encodeURIComponent(appRelativePath)}/.dyad/media/${encodeURIComponent(filename)}`;

      // Build display tag for inline rendering (escape attribute values)
      displayAttachmentInfo += `\n<dyad-attachment name="${escapeXmlAttr(attachment.name)}" type="${escapeXmlAttr(attachment.type)}" url="${escapeXmlAttr(mediaUrl)}" path="${escapeXmlAttr(persistentPath)}" attachment-type="${escapeXmlAttr(attachment.attachmentType)}"></dyad-attachment>\n`;

      if (attachment.attachmentType === "upload-to-codebase") {
        // Provide the .dyad/media path so the AI can copy it into the codebase
        attachmentInfo += `\n\nFile to upload to codebase: "${attachment.name}" (path: ${persistentPath})\nUse the copy_file tool when tools are available, or emit a <dyad-copy> tag otherwise, to copy this file into the codebase at the appropriate location.\n`;
      } else {
        // For chat-context, provide file info for reference (no path to avoid auto-copying)
        attachmentInfo += `- ${attachment.name} (${attachment.type})\n`;
        // If it's a text-based file, try to include the content
        if (await isTextFile(persistentPath)) {
          try {
            attachmentInfo += `<dyad-text-attachment filename="${escapeXmlAttr(attachment.name)}" type="${escapeXmlAttr(attachment.type)}" path="${escapeXmlAttr(persistentPath)}">
                </dyad-text-attachment>
                \n\n`;
          } catch (err) {
            logger.error(`Error reading file content: ${err}`);
          }
        }
      }
    }

    return { attachmentInfo, displayAttachmentInfo };
  }

  /**
   * Resolves `@media:` mentions to stored media files, registering them as
   * chat-context attachments and stripping resolved mentions from the
   * prompts. Returns updated AI and display prompts.
   */
  async resolveMediaMentionAttachments({
    userPrompt,
    displayUserPrompt,
    originalPrompt,
    appRelativePath,
    appName,
    collector,
  }: {
    userPrompt: string;
    displayUserPrompt: string | undefined;
    originalPrompt: string;
    appRelativePath: string;
    appName: string;
    collector: AttachmentCollector;
  }): Promise<{ userPrompt: string; displayUserPrompt: string | undefined }> {
    const mediaRefs = parseMediaMentions(userPrompt);
    if (mediaRefs.length === 0) {
      return { userPrompt, displayUserPrompt };
    }
    try {
      const resolvedMedia = await resolveMediaMentions(
        mediaRefs,
        appRelativePath,
        appName,
      );
      const resolvedMediaRefs = resolvedMedia.map((media) =>
        encodeURIComponent(media.fileName),
      );
      let mediaDisplayInfo = "";
      for (const media of resolvedMedia) {
        collector.attachmentPaths.push(media.filePath);
        const logicalName = createUniqueAttachmentLogicalName(
          media.fileName,
          collector.usedLogicalNames,
        );
        const stat = await fs.promises.stat(media.filePath);
        collector.pendingStoredAttachments.push({
          filePath: media.filePath,
          attachmentType: "chat-context",
        });
        collector.manifestEntries.push({
          requestedLogicalName: logicalName,
          originalName: media.fileName,
          storedFileName: media.fileName,
          mimeType: media.mimeType,
          sizeBytes: stat.size,
          createdAt: new Date().toISOString(),
        });
        const mediaUrl = buildDyadMediaUrl(appRelativePath, media.fileName);
        mediaDisplayInfo += `\n<dyad-attachment name="${escapeXmlAttr(media.fileName)}" type="${escapeXmlAttr(media.mimeType)}" url="${escapeXmlAttr(mediaUrl)}" path="${escapeXmlAttr(media.filePath)}" attachment-type="chat-context"></dyad-attachment>\n`;
      }
      // Strip only resolved @media: tags from the prompt text.
      // This preserves adjacent user text when mentions are directly followed
      // by text without a whitespace separator.
      userPrompt = stripResolvedMediaMentions(userPrompt, resolvedMediaRefs);
      // Build display prompt with attachment tags for inline rendering.
      if (mediaDisplayInfo) {
        const strippedPrompt = stripResolvedMediaMentions(
          displayUserPrompt ?? originalPrompt,
          resolvedMediaRefs,
        );
        displayUserPrompt = strippedPrompt + mediaDisplayInfo;
      }
    } catch (e) {
      logger.error("Failed to resolve media mentions:", e);
    }
    return { userPrompt, displayUserPrompt };
  }

  /**
   * Appends collected manifest entries to the app's attachment manifest and
   * returns the finalized stored attachments.
   */
  async finalizeStoredAttachments({
    appPath,
    collector,
  }: {
    appPath: string;
    collector: AttachmentCollector;
  }): Promise<StoredChatAttachment[]> {
    const finalizedManifestEntries =
      await appendAttachmentManifestEntriesWithLogicalNames(
        appPath,
        collector.manifestEntries,
      );
    return finalizedManifestEntries.map((entry, index) => ({
      ...entry,
      filePath: collector.pendingStoredAttachments[index].filePath,
      attachmentType: collector.pendingStoredAttachments[index].attachmentType,
    }));
  }

  /**
   * Converts a traditional message to one with proper image attachments:
   * inlines text-file contents and appends base64 image parts.
   */
  async prepareMessageWithAttachments(
    message: ModelMessage,
    attachmentPaths: string[],
    {
      includeImageAttachments = true,
      inlineTextAttachments = true,
    }: {
      includeImageAttachments?: boolean;
      inlineTextAttachments?: boolean;
    } = {},
  ): Promise<ModelMessage> {
    let textContent = message.content;
    // Get the original text content
    if (typeof textContent !== "string") {
      logger.warn(
        "Message content is not a string - shouldn't happen but using message as-is",
      );
      return message;
    }

    if (inlineTextAttachments) {
      // Process text file attachments - replace placeholder tags with full content
      for (const filePath of attachmentPaths) {
        const fileName = path.basename(filePath);
        textContent = await this.replaceTextAttachmentWithContent(
          textContent,
          filePath,
          fileName,
        );
      }
    }

    // For user messages with attachments, create a content array
    const contentParts: (TextPart | ImagePart)[] = [];

    // Add the text part first with possibly modified content
    contentParts.push({
      type: "text",
      text: textContent,
    });

    if (includeImageAttachments) {
      // Add image parts for any image attachments
      for (const filePath of attachmentPaths) {
        const mimeType = getInlineImageMimeType(filePath);
        if (mimeType) {
          try {
            // Read the file as a buffer and convert to base64 string
            // Using base64 strings instead of raw Buffers ensures proper JSON serialization
            // for storage in aiMessagesJson (raw Buffers serialize inefficiently and exceed size limits)
            const imageBuffer = await readFile(filePath);
            const base64Data = imageBuffer.toString("base64");

            // Add the image to the content parts with base64 data and mediaType
            contentParts.push({
              type: "image",
              image: base64Data,
              mediaType: mimeType,
            });

            logger.log(`Added image attachment: ${filePath}`);
          } catch (error) {
            logger.error(`Error reading image file: ${error}`);
          }
        }
      }
    }

    // Return the message with the content array
    return {
      role: "user",
      content: contentParts,
    };
  }

  /** Replaces text attachment placeholder tags with the file's full content. */
  private async replaceTextAttachmentWithContent(
    text: string,
    filePath: string,
    fileName: string,
  ): Promise<string> {
    try {
      if (await isTextFile(filePath)) {
        // Read the full content
        const fullContent = await readFile(filePath, "utf-8");

        // Replace the placeholder tag with the full content.
        // The path attribute in the tag is XML-escaped (via escapeXmlAttr), so we
        // must also XML-escape the path before regex-escaping to ensure a match.
        const xmlEscapedPath = escapeXmlAttr(filePath);
        const escapedPath = xmlEscapedPath.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        );
        const tagPattern = new RegExp(
          `<dyad-text-attachment filename="[^"]*" type="[^"]*" path="${escapedPath}">\\s*<\\/dyad-text-attachment>`,
          "g",
        );

        const replacedText = text.replace(
          tagPattern,
          `Full content of ${fileName}:\n\`\`\`\n${fullContent}\n\`\`\``,
        );

        logger.log(
          `Replaced text attachment content for: ${fileName} - length before: ${text.length} - length after: ${replacedText.length}`,
        );
        return replacedText;
      }
      return text;
    } catch (error) {
      logger.error(`Error processing text file: ${error}`);
      return text;
    }
  }
}

export const chatAttachmentService = new ChatAttachmentService();
