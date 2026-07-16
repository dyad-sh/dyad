/**
 * Server-dump processing for the chat-flow harness.
 *
 * The fake-LLM server writes each `[dump]`-triggered request body to a JSON
 * file and embeds `[[dyad-dump-path=<file>]]` in its streamed reply. This
 * module reads that file and applies the SAME normalizations the Playwright
 * PageObject.snapshotServerDump uses, so migrated payload snapshots stay
 * deterministic and comparable.
 *
 * It reuses the e2e normalization helpers directly (single source of truth) and
 * re-implements the two helpers that live privately inside PageObject.ts
 * (ignored-file stripping + system-message masking). It ALSO adds two harness-
 * only normalizations requested for the migration path:
 *   - `tools[].description` -> `[[TOOL_DESC:<name>]]`
 *   - `body.model`          -> `[[MODEL]]`
 * both configurable and on by default.
 */
import fs from "node:fs";

import { prettifyDump } from "../../e2e-tests/helpers/utils/dump-prettifier";
import {
  normalizeGitContextHashes,
  normalizeItemReferences,
  normalizeMcpCallIds,
  normalizeToolCallIds,
  normalizeVersionedFiles,
  normalizePath,
} from "../../e2e-tests/helpers/utils/normalization";

const IGNORED_SNAPSHOT_FILE_PATHS = new Set([".gitattributes"]);

function isIgnoredSnapshotFile(filePath: string | undefined): boolean {
  return (
    typeof filePath === "string" &&
    IGNORED_SNAPSHOT_FILE_PATHS.has(normalizePath(filePath))
  );
}

function removeIgnoredDyadFileBlocks(text: string): string {
  return text
    .replace(
      /\n?<dyad-file path="\.gitattributes">[\s\S]*?<\/dyad-file>\n*/g,
      "",
    )
    .replace(
      /This is my codebase\.\s+(<dyad-file)/g,
      "This is my codebase. $1",
    );
}

function sanitizeContentForSnapshot(content: unknown): unknown {
  if (typeof content === "string") {
    return removeIgnoredDyadFileBlocks(content);
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text: unknown }).text === "string"
      ) {
        return {
          ...part,
          text: removeIgnoredDyadFileBlocks((part as { text: string }).text),
        };
      }
      return part;
    });
  }
  return content;
}

/** Port of PageObject.removeIgnoredSnapshotFilesFromDump. */
function removeIgnoredSnapshotFilesFromDump(dump: any): void {
  const body = dump?.body;
  if (!body) {
    return;
  }

  for (const key of ["input", "messages"] as const) {
    if (Array.isArray(body[key])) {
      body[key] = body[key].map((message: any) => ({
        ...message,
        content: sanitizeContentForSnapshot(message.content),
      }));
    }
  }

  if (Array.isArray(body.dyad_options?.files)) {
    body.dyad_options.files = body.dyad_options.files.filter(
      (file: any) => !isIgnoredSnapshotFile(file.path),
    );
  }

  if (Array.isArray(body.dyad_options?.mentioned_apps)) {
    for (const mentionedApp of body.dyad_options.mentioned_apps) {
      if (Array.isArray(mentionedApp.files)) {
        mentionedApp.files = mentionedApp.files.filter(
          (file: any) => !isIgnoredSnapshotFile(file.path),
        );
      }
    }
  }

  const vf = body.dyad_options?.versioned_files;
  if (!vf) {
    return;
  }

  const ignoredFileIds = new Set<string>();
  if (Array.isArray(vf.fileReferences)) {
    vf.fileReferences = vf.fileReferences.filter((ref: any) => {
      if (isIgnoredSnapshotFile(ref.path)) {
        if (typeof ref.fileId === "string") {
          ignoredFileIds.add(ref.fileId);
        }
        return false;
      }
      return true;
    });
  }

  if (vf.fileIdToContent) {
    for (const fileId of ignoredFileIds) {
      delete vf.fileIdToContent[fileId];
    }
  }

  if (vf.messageIndexToFilePathToFileId) {
    for (const pathToId of Object.values(
      vf.messageIndexToFilePathToFileId as Record<
        string,
        Record<string, string>
      >,
    )) {
      for (const [filePath, id] of Object.entries(pathToId)) {
        if (isIgnoredSnapshotFile(filePath)) {
          delete pathToId[filePath];
        } else if (ignoredFileIds.has(id)) {
          delete pathToId[filePath];
        }
      }
    }
  }
}

/** Mask system messages, mirroring PageObject.snapshotServerDump. */
function maskSystemMessages(parsedDump: any): void {
  const body = parsedDump?.body;
  if (!body) {
    return;
  }
  if (Array.isArray(body.input)) {
    body.input = body.input.map((input: any) => {
      if (input.role === "system") {
        input.content = "[[SYSTEM_MESSAGE]]";
      }
      return input;
    });
  }
  if (Array.isArray(body.messages)) {
    body.messages = body.messages.map((message: any) => {
      if (message.role === "system") {
        message.content = "[[SYSTEM_MESSAGE]]";
      }
      return message;
    });
  }
  if (Array.isArray(body.system)) {
    body.system = body.system.map((message: any) => {
      if (message.type === "text") {
        message.text = "[[SYSTEM_MESSAGE]]";
      }
      return message;
    });
  }
}

/**
 * Harness-only: replace each tool's `description` with `[[TOOL_DESC:<name>]]`.
 * Handles both OpenAI (`{ type, function: { name, description } }`) and
 * Anthropic (`{ name, description }`) tool shapes.
 */
function maskToolDescriptions(parsedDump: any): void {
  const tools = parsedDump?.body?.tools;
  if (!Array.isArray(tools)) {
    return;
  }
  for (const tool of tools) {
    if (tool?.function && typeof tool.function === "object") {
      const name = tool.function.name ?? "unknown";
      if ("description" in tool.function) {
        tool.function.description = `[[TOOL_DESC:${name}]]`;
      }
    } else if (tool && typeof tool === "object" && "description" in tool) {
      const name = tool.name ?? "unknown";
      tool.description = `[[TOOL_DESC:${name}]]`;
    }
  }
}

/** Harness-only: replace `body.model` with `[[MODEL]]`. */
function maskModel(parsedDump: any): void {
  if (parsedDump?.body && "model" in parsedDump.body) {
    parsedDump.body.model = "[[MODEL]]";
  }
}

export interface ServerDumpOptions {
  /**
   * "all-messages" (default) / "last-message" prettify the message list.
   * "request" returns the whole normalized request body (JSON) instead.
   */
  type?: "all-messages" | "last-message" | "request";
  /** Which dump to select when several were produced: -1 (default) = last. */
  dumpIndex?: number;
  /** Mask `tools[].description`. Default true. */
  maskToolDescriptions?: boolean;
  /** Mask `body.model`. Default true. */
  maskModel?: boolean;
}

export interface ServerDumpResult {
  /** The fully-normalized parsed dump object. */
  parsed: any;
  /**
   * A stable string for snapshotting: prettified messages for
   * "all-messages"/"last-message", or pretty JSON for "request".
   */
  text: string;
  /** The dump file that was read. */
  dumpPath: string;
}

/** Extract every `[[dyad-dump-path=...]]` path from message text, in order. */
export function extractDumpPaths(text: string): string[] {
  const matches = text.match(/\[\[dyad-dump-path=([^\]]+)\]\]/g) ?? [];
  return matches
    .map((m) => m.match(/\[\[dyad-dump-path=([^\]]+)\]\]/)?.[1])
    .filter((p): p is string => Boolean(p));
}

function scrubDumpFileContent(raw: string): string {
  return raw
    .replaceAll(/\[\[dyad-dump-path=([^\]]+)\]\]/g, "[[dyad-dump-path=*]]")
    .replaceAll(
      /\.dyad[\\/]+chats[\\/]+\d+[\\/]+compaction-[^\s"\\]+\.md/g,
      "[[compaction-backup-path]]",
    );
}

/**
 * Reads and normalizes the dump file at `dumpPaths[dumpIndex]`. Mirrors
 * PageObject.snapshotServerDump but returns values instead of asserting a
 * snapshot, and adds the harness-only masks.
 */
export function readServerDump(
  dumpPaths: string[],
  options: ServerDumpOptions = {},
): ServerDumpResult {
  const {
    type = "all-messages",
    dumpIndex = -1,
    maskToolDescriptions: doMaskToolDescriptions = true,
    maskModel: doMaskModel = true,
  } = options;

  if (dumpPaths.length === 0) {
    throw new Error("No dump path found. Did the prompt trigger a [dump]?");
  }

  const selectedIndex =
    dumpIndex < 0 ? dumpPaths.length + dumpIndex : dumpIndex;
  if (selectedIndex < 0 || selectedIndex >= dumpPaths.length) {
    throw new Error(
      `Dump index ${dumpIndex} is out of range. Found ${dumpPaths.length} dump paths.`,
    );
  }

  const dumpPath = dumpPaths[selectedIndex];
  const parsed = JSON.parse(
    scrubDumpFileContent(fs.readFileSync(dumpPath, "utf-8")),
  );

  removeIgnoredSnapshotFilesFromDump(parsed);
  maskSystemMessages(parsed);
  normalizeToolCallIds(parsed);
  normalizeMcpCallIds(parsed);
  normalizeGitContextHashes(parsed);

  if (doMaskToolDescriptions) {
    maskToolDescriptions(parsed);
  }
  if (doMaskModel) {
    maskModel(parsed);
  }

  if (type === "request") {
    normalizeVersionedFiles(parsed);
    normalizeItemReferences(parsed);
    return {
      parsed,
      text: JSON.stringify(parsed, null, 2).replace(/\\r\\n/g, "\\n"),
      dumpPath,
    };
  }

  const messages = parsed?.body?.input ?? parsed?.body?.messages ?? [];
  return {
    parsed,
    text: prettifyDump(messages, { onlyLastMessage: type === "last-message" }),
    dumpPath,
  };
}
