/**
 * Utility functions for normalizing test data to ensure deterministic snapshots.
 */

/**
 * Normalizes item_reference IDs in the input array to be deterministic.
 * item_reference objects have the shape { type: "item_reference", id: "msg_..." }
 * where the ID is a timestamp-based value that changes between test runs.
 */
export function normalizeItemReferences(dump: any): void {
  const input = dump?.body?.input;
  if (!Array.isArray(input)) {
    return;
  }

  let refIndex = 0;
  for (const item of input) {
    if (item?.type === "item_reference" && item?.id) {
      item.id = `[[ITEM_REF_${refIndex}]]`;
      refIndex++;
    }
  }
}

/**
 * Normalizes tool_call IDs and tool_call_id references to be deterministic.
 * Tool call IDs have the format "call_[timestamp]_[index]" which changes between runs.
 */
export function normalizeToolCallIds(dump: any): void {
  const messages = dump?.body?.messages;
  if (!Array.isArray(messages)) {
    return;
  }

  const oldToNewId: Record<string, string> = {};
  let toolCallIndex = 0;

  // First pass: collect all tool_call IDs and create mapping
  for (const message of messages) {
    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (toolCall?.id && !oldToNewId[toolCall.id]) {
          oldToNewId[toolCall.id] = `[[TOOL_CALL_${toolCallIndex}]]`;
          toolCallIndex++;
        }
      }
    }
  }

  // Second pass: replace all IDs
  for (const message of messages) {
    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (toolCall?.id && oldToNewId[toolCall.id]) {
          toolCall.id = oldToNewId[toolCall.id];
        }
      }
    }
    if (message?.tool_call_id && oldToNewId[message.tool_call_id]) {
      message.tool_call_id = oldToNewId[message.tool_call_id];
    }
  }
}

/**
 * Normalizes fileId hashes in versioned_files to be deterministic.
 * FileIds are SHA-256 hashes that may include non-deterministic components
 * like app paths with timestamps. This replaces them with stable placeholders
 * based on content sorting.
 */
export function normalizeVersionedFiles(dump: any): void {
  const vf = dump?.body?.coney_options?.versioned_files;
  if (!vf?.fileIdToContent) {
    return;
  }

  const fileIdToContent = vf.fileIdToContent as Record<string, string>;

  // Create mapping from old fileId to new deterministic fileId
  // Sort by content to ensure deterministic ordering
  const entries = Object.entries(fileIdToContent).sort((a, b) =>
    String(a[1]).localeCompare(String(b[1])),
  );

  const oldToNewId: Record<string, string> = {};
  const newFileIdToContent: Record<string, string> = {};

  entries.forEach(([oldId, content], index) => {
    const newId = `[[FILE_ID_${index}]]`;
    oldToNewId[oldId] = newId;
    newFileIdToContent[newId] = content;
  });

  vf.fileIdToContent = newFileIdToContent;

  // Update fileReferences
  if (vf.fileReferences) {
    vf.fileReferences = vf.fileReferences.map((ref: any) => ({
      ...ref,
      fileId: oldToNewId[ref.fileId] ?? ref.fileId,
    }));
  }

  // Update messageIndexToFilePathToFileId
  if (vf.messageIndexToFilePathToFileId) {
    for (const pathToId of Object.values(
      vf.messageIndexToFilePathToFileId as Record<
        string,
        Record<string, string>
      >,
    )) {
      for (const [filePath, id] of Object.entries(pathToId)) {
        pathToId[filePath] = oldToNewId[id] ?? id;
      }
    }
  }
}

/**
 * Normalizes path separators to always use forward slashes.
 * Used for cross-platform consistency in tests.
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
