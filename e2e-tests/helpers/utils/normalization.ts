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
/**
 * Normalizes MCP `call-id="..."` attributes embedded inside message content
 * strings (used by the merged tool card to pair call/result blocks). These
 * carry the provider tool-call id, which is non-deterministic, so replace each
 * distinct value with a stable placeholder in first-seen order.
 */
export function normalizeMcpCallIds(dump: any): void {
  const oldToNew: Record<string, string> = {};
  let idx = 0;
  const scrub = (s: string): string =>
    s.replace(/call-id="([^"]*)"/g, (_match, id: string) => {
      if (!(id in oldToNew)) {
        oldToNew[id] = `[[MCP_CALL_ID_${idx++}]]`;
      }
      return `call-id="${oldToNew[id]}"`;
    });

  const visit = (value: unknown, set: (v: unknown) => void): void => {
    if (typeof value === "string") {
      set(scrub(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, (v) => (value[i] = v)));
      return;
    }
    if (value && typeof value === "object") {
      for (const key of Object.keys(value)) {
        visit((value as any)[key], (v) => ((value as any)[key] = v));
      }
    }
  };

  visit(dump, () => {});
}

/**
 * Git commit IDs depend on commit metadata and are intentionally included in
 * replay annotations. Snapshot their presence and shape without pinning the
 * repository-specific hash.
 */
export function normalizeGitContextHashes(dump: any): void {
  const scrub = (value: string): string =>
    value.replace(/<dyad-git-context\b[^>]*>/g, (tag) =>
      tag.replace(
        /\b(commit|source_commit)="[0-9a-f]{40,64}"/gi,
        '$1="[[GIT_COMMIT]]"',
      ),
    );

  const visit = (value: unknown, set: (next: unknown) => void): void => {
    if (typeof value === "string") {
      set(scrub(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        visit(item, (next) => {
          value[index] = next;
        }),
      );
      return;
    }
    if (value && typeof value === "object") {
      for (const key of Object.keys(value)) {
        visit((value as any)[key], (next) => {
          (value as any)[key] = next;
        });
      }
    }
  };

  visit(dump, () => {});
}

export function normalizeToolCallIds(dump: any): void {
  const oldToNewId: Record<string, string> = {};
  let toolCallIndex = 0;

  const addMapping = (id: unknown) => {
    if (typeof id !== "string" || !/^call_\d+_\d+$/.test(id)) {
      return;
    }
    if (!oldToNewId[id]) {
      oldToNewId[id] = `[[TOOL_CALL_${toolCallIndex}]]`;
      toolCallIndex++;
    }
  };

  const visit = (value: unknown, visitor: (object: any) => void) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, visitor);
      }
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    visitor(value);
    for (const child of Object.values(value)) {
      visit(child, visitor);
    }
  };

  // First pass: collect all tool_call IDs and create mapping
  visit(dump, (object) => {
    if (Array.isArray(object?.tool_calls)) {
      for (const toolCall of object.tool_calls) {
        addMapping(toolCall?.id);
      }
    }
    if (object?.type === "tool_use") {
      addMapping(object.id);
    }
  });

  // Second pass: replace all IDs
  visit(dump, (object) => {
    if (Array.isArray(object?.tool_calls)) {
      for (const toolCall of object.tool_calls) {
        if (toolCall?.id && oldToNewId[toolCall.id]) {
          toolCall.id = oldToNewId[toolCall.id];
        }
      }
    }
    if (object?.id && oldToNewId[object.id]) {
      object.id = oldToNewId[object.id];
    }
    if (object?.tool_call_id && oldToNewId[object.tool_call_id]) {
      object.tool_call_id = oldToNewId[object.tool_call_id];
    }
    if (object?.tool_use_id && oldToNewId[object.tool_use_id]) {
      object.tool_use_id = oldToNewId[object.tool_use_id];
    }
  });
}

/**
 * Normalizes fileId hashes in versioned_files to be deterministic.
 * FileIds are SHA-256 hashes that may include non-deterministic components
 * like app paths with timestamps. This replaces them with stable placeholders
 * based on content sorting.
 */
export function normalizeVersionedFiles(dump: any): void {
  const vf = dump?.body?.dyad_options?.versioned_files;
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
