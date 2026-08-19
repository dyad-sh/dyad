/**
 * Writing conversations into the memory vault.
 *
 * Saving is append-only and idempotent: each save writes just the turns the
 * file does not already hold. A crash between turns therefore costs nothing,
 * and a retry cannot duplicate the transcript.
 *
 * Failures are swallowed by design. Losing a saved turn is regrettable; taking
 * down the conversation the user is having is not acceptable, so every entry
 * point here reports rather than throws.
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

import { readSettings } from "../../main/settings";
import { memoryPath } from "./memory_vault";
import {
  conversationFileName,
  conversationHeader,
  renderTurn,
  turnsToAppend,
  type ConversationTurn,
} from "./memory_documents";
import { indexMemoryVault } from "./memory_index";
import { enqueueJob } from "./memory_jobs";
import { runWorker } from "./memory_worker";
import {
  deleteBlob,
  getBlobBuffer,
  isBlobConnected,
  listBlobs,
  uploadToBlob,
} from "./vercel_blob";
import { blobVaultKey } from "./blob_vault";

/**
 * Runs the extraction worker without letting two runs overlap.
 *
 * One job at a time by default: extraction writes to shared files, and a
 * second concurrent pass would race them.
 */
let shuttingDown = false;
let workerChain: Promise<void> = Promise.resolve();

export function stopMemoryWorker(): void {
  shuttingDown = true;
}

function scheduleWorker(vaultPath: string): Promise<void> {
  if (shuttingDown) return Promise.resolve();
  const pass = workerChain.then(async () => {
    if (shuttingDown) return;
    try {
      await runWorker(vaultPath, {
        signal: {
          get aborted() {
            return shuttingDown;
          },
        },
      });
    } catch (error) {
      logger.warn("Memory worker pass failed", error);
    }
  });
  // Keep future passes serialized even when an individual pass fails.
  workerChain = pass.catch(() => undefined);
  return pass;
}

const logger = log.scope("conversation_store");

/**
 * Which file each session is being written to.
 *
 * The vault it belongs to is remembered too: if the user points the app at a
 * different vault mid-session, the old path is abandoned rather than written
 * to a location that is no longer theirs.
 */
const sessionFiles = new Map<string, { vaultPath: string; filePath: string }>();
const CONVERSATION_RECORDS_PATH = ".meta-human/conversations";

export type StoredConversationRecord = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ConversationTurn[];
  vectorCollectionIds?: string[];
  dataSourceIds?: string[];
  projectId?: string | null;
};

export type StoredConversationContext = Pick<
  StoredConversationRecord,
  "vectorCollectionIds" | "dataSourceIds" | "projectId"
> & {
  /** Wait until an explicit remember command is searchable before replying. */
  waitForMemoryExtraction?: boolean;
};

function titleFor(turns: ConversationTurn[]): string {
  const firstUser = turns.find((turn) => turn.role === "user");
  if (!firstUser) return "Conversation";
  const visibleRequest = firstUser.content.includes("MCP_TOOL_MENU_SELECTION")
    ? (firstUser.content.match(/(?:^|\n)User request:\s*([\s\S]+)$/i)?.[1] ??
      firstUser.content)
    : firstUser.content;
  return (
    visibleRequest.trim().split(/\r?\n/)[0]!.slice(0, 60) || "Conversation"
  );
}

function safeFilePart(value: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 100) || "Conversation"
  );
}

function portableConversationMarkdown(
  sessionId: string,
  turns: ConversationTurn[],
) {
  const now = new Date().toISOString();
  return (
    conversationHeader({
      id: sessionId,
      title: titleFor(turns),
      created: now,
      updated: now,
      project: null,
    }) + turns.map(renderTurn).join("")
  );
}

function storedRecord(
  sessionId: string,
  turns: ConversationTurn[],
  context: StoredConversationContext = {},
): StoredConversationRecord {
  return {
    id: sessionId,
    title: titleFor(turns),
    updatedAt: Date.now(),
    messages: turns,
    ...(context.vectorCollectionIds?.length
      ? { vectorCollectionIds: context.vectorCollectionIds }
      : {}),
    ...(context.dataSourceIds?.length
      ? { dataSourceIds: context.dataSourceIds }
      : {}),
    ...(context.projectId !== undefined
      ? { projectId: context.projectId }
      : {}),
  };
}

function recordRelativePath(sessionId: string) {
  return `${CONVERSATION_RECORDS_PATH}/${safeFilePart(sessionId)}.json`;
}

async function writeLocalRecord(
  vaultPath: string,
  record: StoredConversationRecord,
) {
  const filePath = path.join(
    vaultPath,
    ...recordRelativePath(record.id).split("/"),
  );
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(temporary, JSON.stringify(record, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.promises.rename(temporary, filePath);
}

/**
 * Appends whatever is new in this conversation to its Markdown file.
 *
 * Returns the file's vault-relative path, or null when nothing was saved —
 * because there is no vault, or because saving failed.
 */
export async function saveConversation(
  sessionId: string,
  turns: ConversationTurn[],
  context: StoredConversationContext = {},
): Promise<string | null> {
  if (turns.length === 0) return null;
  const storage = readSettings().storage;
  if (storage?.syncConversations === false) return null;

  if (storage?.destination === "cloud") {
    if (!isBlobConnected()) return null;
    try {
      const relativePath = `Conversations/Chat Agent/${safeFilePart(titleFor(turns))} - ${safeFilePart(sessionId)}.md`;
      const record = storedRecord(sessionId, turns, context);
      await Promise.all([
        uploadToBlob(
          blobVaultKey(relativePath),
          portableConversationMarkdown(sessionId, turns),
          {
            allowOverwrite: true,
            contentType: "text/markdown; charset=utf-8",
          },
        ),
        uploadToBlob(
          blobVaultKey(recordRelativePath(sessionId)),
          JSON.stringify(record),
          {
            allowOverwrite: true,
            contentType: "application/json",
          },
        ),
      ]);
      return relativePath;
    } catch (error) {
      logger.warn(`Could not save cloud conversation ${sessionId}`, error);
      return null;
    }
  }

  const vaultPath = storage?.localVaultPath?.trim();
  if (!vaultPath) return null;

  try {
    const directory = memoryPath(vaultPath, "Conversations");
    await fs.promises.mkdir(directory, { recursive: true });

    const remembered = sessionFiles.get(sessionId);
    let filePath =
      remembered && remembered.vaultPath === vaultPath
        ? remembered.filePath
        : undefined;
    if (!filePath) {
      filePath = path.join(
        directory,
        conversationFileName(new Date(), titleFor(turns)),
      );
      sessionFiles.set(sessionId, { vaultPath, filePath });
    }

    const now = new Date().toISOString();
    let existing = "";
    if (fs.existsSync(filePath)) {
      existing = await fs.promises.readFile(filePath, "utf8");
    } else {
      const header = conversationHeader({
        id: sessionId,
        title: titleFor(turns),
        created: now,
        updated: now,
        project: null,
      });
      await fs.promises.writeFile(filePath, header, "utf8");
      existing = header;
    }

    const pending = turnsToAppend(existing, turns);
    if (pending.length === 0) return relative(vaultPath, filePath);

    await fs.promises.appendFile(
      filePath,
      pending.map(renderTurn).join(""),
      "utf8",
    );
    await writeLocalRecord(vaultPath, storedRecord(sessionId, turns, context));

    // Re-index in the background. The saved Markdown is already durable, so a
    // failure here costs only searchability until the next save.
    void indexMemoryVault(vaultPath).catch((error) => {
      logger.warn("Could not re-index memory after saving", error);
    });

    // Queue extraction durably. Ordinary conversation stays off the reply's
    // critical path. An explicit "remember" command waits for the worker so a
    // newly opened chat cannot race the memory write.
    const extraction = enqueueJob(vaultPath, {
      conversationId: sessionId,
      conversationPath: relative(vaultPath, filePath),
      content: existing + pending.map(renderTurn).join(""),
    }).then(async (queued) => {
      if (queued) await scheduleWorker(vaultPath);
    });
    if (context.waitForMemoryExtraction) {
      await extraction;
    } else {
      void extraction.catch((error) =>
        logger.warn("Could not queue memory extraction", error),
      );
    }

    return relative(vaultPath, filePath);
  } catch (error) {
    logger.warn(`Could not save conversation ${sessionId}`, error);
    return null;
  }
}

function relative(vaultPath: string, filePath: string): string {
  return path.relative(vaultPath, filePath).replace(/\\/g, "/");
}

/** Forgets a session's file, so a new conversation starts a new file. */
export function forgetConversationFile(sessionId: string): void {
  sessionFiles.delete(sessionId);
}

function frontmatterHasConversationId(content: string, sessionId: string) {
  const escaped = sessionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^(?:id|conversation_id):\\s*["']?${escaped}["']?\\s*$`,
    "m",
  ).test(content.slice(0, 4_096));
}

async function removeMatchingLocalFiles(root: string, sessionId: string) {
  const directories = [
    memoryPath(root, "Conversations"),
    path.join(root, "Conversations", "Chat Agent"),
  ];
  let deleted = 0;
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    const entries = await fs.promises.readdir(directory, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (
        !entry.isFile() ||
        entry.name.startsWith("._") ||
        !entry.name.endsWith(".md")
      ) {
        continue;
      }
      const filePath = path.join(directory, entry.name);
      const filenameMatches = entry.name.endsWith(
        ` - ${safeFilePart(sessionId)}.md`,
      );
      const contentMatches = filenameMatches
        ? true
        : frontmatterHasConversationId(
            await fs.promises.readFile(filePath, "utf8"),
            sessionId,
          );
      if (!contentMatches) continue;
      await fs.promises.rm(filePath, { force: true });
      deleted += 1;
    }
  }
  return deleted;
}

/** Deletes the durable transcript from whichever storage destination owns it. */
export async function deleteStoredConversation(sessionId: string) {
  const storage = readSettings().storage;
  sessionFiles.delete(sessionId);
  if (storage?.destination === "cloud") {
    if (!isBlobConnected()) return 0;
    const items = [
      ...(await listBlobs(blobVaultKey("Conversations/Chat Agent/"))),
      ...(await listBlobs(blobVaultKey(`${CONVERSATION_RECORDS_PATH}/`))),
    ];
    const suffix = ` - ${safeFilePart(sessionId)}.md`;
    const recordSuffix = `/${safeFilePart(sessionId)}.json`;
    const matches = items.filter(
      (item) =>
        item.pathname.endsWith(suffix) || item.pathname.endsWith(recordSuffix),
    );
    await Promise.all(matches.map((item) => deleteBlob(item.url)));
    return matches.length;
  }
  const vaultPath = storage?.localVaultPath?.trim();
  if (!vaultPath) return 0;
  let deleted = await removeMatchingLocalFiles(vaultPath, sessionId);
  const recordPath = path.join(
    vaultPath,
    ...recordRelativePath(sessionId).split("/"),
  );
  if (fs.existsSync(recordPath)) {
    await fs.promises.rm(recordPath, { force: true });
    deleted += 1;
  }
  if (deleted > 0) {
    void indexMemoryVault(vaultPath).catch((error) => {
      logger.warn(
        "Could not re-index memory after deleting conversation",
        error,
      );
    });
  }
  return deleted;
}

function parseStoredRecord(value: unknown): StoredConversationRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.title !== "string" ||
    typeof record.updatedAt !== "number" ||
    !Array.isArray(record.messages)
  ) {
    return null;
  }
  const messages: ConversationTurn[] = [];
  for (const message of record.messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      continue;
    }
    const item = message as Record<string, unknown>;
    if (
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string"
    ) {
      messages.push({ role: item.role, content: item.content });
    }
  }
  return {
    id: record.id,
    title: record.title,
    updatedAt: record.updatedAt,
    messages,
    ...(Array.isArray(record.vectorCollectionIds)
      ? {
          vectorCollectionIds: record.vectorCollectionIds.filter(
            (id): id is string => typeof id === "string",
          ),
        }
      : {}),
    ...(Array.isArray(record.dataSourceIds)
      ? {
          dataSourceIds: record.dataSourceIds.filter(
            (id): id is string => typeof id === "string",
          ),
        }
      : {}),
    ...(record.projectId === null || typeof record.projectId === "string"
      ? { projectId: record.projectId }
      : {}),
  };
}

/** Loads durable Chat Agent records from the currently selected destination. */
export async function listStoredConversations() {
  const storage = readSettings().storage;
  const records: StoredConversationRecord[] = [];
  if (storage?.destination === "cloud") {
    if (!isBlobConnected()) return records;
    const items = await listBlobs(
      blobVaultKey(`${CONVERSATION_RECORDS_PATH}/`),
    );
    for (const item of items.slice(0, 500)) {
      if (!item.pathname.endsWith(".json")) continue;
      try {
        const buffer = await getBlobBuffer(item.url);
        const record = buffer
          ? parseStoredRecord(JSON.parse(buffer.toString("utf8")))
          : null;
        if (record) records.push(record);
      } catch (error) {
        logger.warn(
          `Could not read stored conversation ${item.pathname}`,
          error,
        );
      }
    }
  } else {
    const vaultPath = storage?.localVaultPath?.trim();
    if (!vaultPath) return records;
    const directory = path.join(
      vaultPath,
      ...CONVERSATION_RECORDS_PATH.split("/"),
    );
    if (!fs.existsSync(directory)) return records;
    const entries = await fs.promises.readdir(directory, {
      withFileTypes: true,
    });
    for (const entry of entries.slice(0, 500)) {
      if (
        !entry.isFile() ||
        entry.name.startsWith("._") ||
        !entry.name.endsWith(".json")
      ) {
        continue;
      }
      try {
        const raw = await fs.promises.readFile(
          path.join(directory, entry.name),
          "utf8",
        );
        const record = parseStoredRecord(JSON.parse(raw));
        if (record) records.push(record);
      } catch (error) {
        logger.warn(`Could not read stored conversation ${entry.name}`, error);
      }
    }
  }
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}
