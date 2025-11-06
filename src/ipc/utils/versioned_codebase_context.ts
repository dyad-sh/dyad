import { CodebaseFile, CodebaseFileReference } from "@/utils/codebase";
import { ModelMessage } from "@ai-sdk/provider-utils";
import crypto from "node:crypto";
import log from "electron-log";
import { getFileAtCommit } from "./git_utils";
import { normalizePath } from "../../../shared/normalizePath";

const logger = log.scope("versioned_codebase_context");

export interface VersionedFiles {
  fileIdToContent: Record<string, string>;
  fileReferences: CodebaseFileReference[];
  messageIndexToFilePathToFileId: Record<number, Record<string, string>>;
}

interface DyadEngineProviderOptions {
  sourceCommitHash: string;
}

/**
 * Parse file paths from assistant message content.
 * Extracts files from <dyad-read> and <dyad-code-search-result> tags.
 */
export function parseFilesFromMessage(content: string): string[] {
  const filePaths: string[] = [];
  const seenPaths = new Set<string>();

  // Create an array of matches with their positions to maintain order
  interface TagMatch {
    index: number;
    filePaths: string[];
  }
  const matches: TagMatch[] = [];

  // Parse <dyad-read path="$filePath"></dyad-read>
  const dyadReadRegex = /<dyad-read\s+path="([^"]+)"\s*><\/dyad-read>/gs;
  let match: RegExpExecArray | null;
  while ((match = dyadReadRegex.exec(content)) !== null) {
    const filePath = normalizePath(match[1].trim());
    if (filePath) {
      matches.push({
        index: match.index,
        filePaths: [filePath],
      });
    }
  }

  // Parse <dyad-code-search-result>...</dyad-code-search-result>
  const codeSearchRegex =
    /<dyad-code-search-result>(.*?)<\/dyad-code-search-result>/gs;
  while ((match = codeSearchRegex.exec(content)) !== null) {
    const innerContent = match[1];
    const paths: string[] = [];
    // Split by newlines and extract each file path
    const lines = innerContent.split("\n");
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (
        trimmedLine &&
        !trimmedLine.startsWith("<") &&
        !trimmedLine.startsWith(">")
      ) {
        paths.push(normalizePath(trimmedLine));
      }
    }
    if (paths.length > 0) {
      matches.push({
        index: match.index,
        filePaths: paths,
      });
    }
  }

  // Sort matches by their position in the original content
  matches.sort((a, b) => a.index - b.index);

  // Add file paths in order, deduplicating as we go
  for (const match of matches) {
    for (const path of match.filePaths) {
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        filePaths.push(path);
      }
    }
  }

  return filePaths;
}

export async function processChatMessagesWithVersionedFiles({
  files,
  chatMessages,
  appPath,
}: {
  files: CodebaseFile[];
  chatMessages: ModelMessage[];
  appPath: string;
}): Promise<VersionedFiles> {
  const fileIdToContent: Record<string, string> = {};
  const fileReferences: CodebaseFileReference[] = [];
  const messageIndexToFilePathToFileId: Record<
    number,
    Record<string, string>
  > = {};
  for (const file of files) {
    // Generate SHA-256 hash of content as fileId
    const fileId = crypto
      .createHash("sha256")
      .update(file.content)
      .digest("hex");

    fileIdToContent[fileId] = file.content;
    const { content: _content, ...restOfFile } = file;

    fileReferences.push({
      ...restOfFile,
      fileId,
    });
  }

  for (
    let messageIndex = 0;
    messageIndex < chatMessages.length;
    messageIndex++
  ) {
    const message = chatMessages[messageIndex];

    // Only process assistant messages
    if (message.role !== "assistant") {
      continue;
    }

    // Extract sourceCommitHash from providerOptions
    const engineOptions = message.providerOptions?.[
      "dyad-engine"
    ] as unknown as DyadEngineProviderOptions;
    const sourceCommitHash = engineOptions?.sourceCommitHash;

    // Skip messages without sourceCommitHash
    if (!sourceCommitHash) {
      continue;
    }

    // Get message content as text
    const content = message.content;
    let textContent: string;

    if (typeof content !== "string") {
      // Handle array of parts (text, images, etc.)
      textContent = content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");

      if (!textContent) {
        continue;
      }
    } else {
      // Message content is already a string
      textContent = content;
    }

    // Parse file paths from message content
    const filePaths = parseFilesFromMessage(textContent);
    const filePathsToFileIds: Record<string, string> = {};
    messageIndexToFilePathToFileId[messageIndex] = filePathsToFileIds;

    // Parallelize file content fetching
    const fileContentPromises = filePaths.map((filePath) =>
      getFileAtCommit({
        path: appPath,
        filePath,
        commitHash: sourceCommitHash,
      }).then(
        (content) => ({ filePath, content, status: "fulfilled" as const }),
        (error) => ({ filePath, error, status: "rejected" as const }),
      ),
    );

    const results = await Promise.all(fileContentPromises);

    for (const result of results) {
      if (result.status === "rejected") {
        logger.error(
          `Error reading file ${result.filePath} at commit ${sourceCommitHash}:`,
          result.error,
        );
        continue;
      }

      const { filePath, content: fileContent } = result;

      if (fileContent === null) {
        logger.warn(
          `File ${filePath} not found at commit ${sourceCommitHash} for message ${messageIndex}`,
        );
        continue;
      }

      // Generate SHA-256 hash of content as fileId
      const fileId = crypto
        .createHash("sha256")
        .update(fileContent)
        .digest("hex");

      // Store in fileIdToContent
      fileIdToContent[fileId] = fileContent;

      // Add to this message's file IDs
      filePathsToFileIds[filePath] = fileId;
    }
  }

  return {
    fileIdToContent,
    fileReferences,
    messageIndexToFilePathToFileId,
  };
}
