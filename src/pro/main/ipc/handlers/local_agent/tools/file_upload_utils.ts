/**
 * Shared utility for resolving file upload IDs to actual file content.
 * When users upload files with "upload-to-codebase" attachment type,
 * the LLM receives a file ID (e.g., DYAD_ATTACHMENT_0) instead of the raw content.
 * This utility replaces those IDs with the actual file content when writing files.
 */

import fs from "node:fs";
import log from "electron-log";
import {
  FileUploadsState,
  FileUploadInfo,
} from "@/ipc/utils/file_uploads_state";

const readFile = fs.promises.readFile;
const logger = log.scope("file_upload_utils");

export interface ResolveFileUploadResult {
  /** The resolved content (either the original content or the uploaded file's content) */
  content: string | Buffer;
  /** Whether a file upload ID was replaced */
  wasReplaced: boolean;
  /** Info about the file that was replaced (if any) */
  fileInfo?: FileUploadInfo;
}

/**
 * Resolves file upload IDs in content to actual file content.
 *
 * If the content (stripped of whitespace) exactly matches a file upload ID
 * (e.g., "DYAD_ATTACHMENT_0"), this function reads the actual uploaded file
 * and returns its content. Otherwise, returns the original content unchanged.
 *
 * @param content - The content to check for file upload IDs
 * @param chatId - The chat ID to look up file uploads for
 * @returns The resolved content and metadata about the replacement
 */
export async function resolveFileUploadContent(
  content: string,
  chatId: number,
): Promise<ResolveFileUploadResult> {
  const fileUploadsState = FileUploadsState.getInstance();
  const fileUploadsMap = fileUploadsState.getFileUploadsForChat(chatId);

  if (fileUploadsMap.size === 0) {
    return { content, wasReplaced: false };
  }

  const trimmedContent = content.trim();
  const fileInfo = fileUploadsMap.get(trimmedContent);

  if (!fileInfo) {
    return { content, wasReplaced: false };
  }

  try {
    const fileContent = await readFile(fileInfo.filePath);
    logger.log(
      `Replaced file ID ${trimmedContent} with content from ${fileInfo.originalName}`,
    );
    return {
      content: fileContent,
      wasReplaced: true,
      fileInfo,
    };
  } catch (error) {
    logger.error(
      `Failed to read uploaded file ${fileInfo.originalName}:`,
      error,
    );
    throw new Error(
      `Failed to read uploaded file: ${fileInfo.originalName}. ${error}`,
    );
  }
}
