import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { getUserDataPath } from "../paths/paths";
import { getDb } from "../db";
import { chats } from "../db/schema";
import { PersistedQueueSchema, type PersistedQueue } from "../ipc/types/queue";

const logger = log.scope("queue_store");

const QUEUE_FILE = "queued-prompts.json";

export function getQueueFilePath(): string {
  return path.join(getUserDataPath(), QUEUE_FILE);
}

/**
 * Read the persisted queued prompts from disk. Returns an empty queue if the
 * file is missing, unreadable, or fails schema validation (never throws — a
 * corrupt file must not crash startup).
 */
export function readPersistedQueue(): PersistedQueue {
  try {
    const filePath = getQueueFilePath();
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = PersistedQueueSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.error("Invalid queued-prompts file, ignoring:", parsed.error);
      return {};
    }
    return parsed.data;
  } catch (error) {
    logger.error("Error reading queued prompts:", error);
    return {};
  }
}

/**
 * Persist the queued prompts to disk using an atomic temp-file + rename so a
 * crash mid-write can't corrupt the file.
 */
export function writePersistedQueue(data: PersistedQueue): void {
  const filePath = getQueueFilePath();
  const tempFilePath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tempFilePath, JSON.stringify(data, null, 2));
    fs.renameSync(tempFilePath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (cleanupError) {
      logger.warn("Failed to remove temporary queue file:", cleanupError);
    }
    throw error;
  }
}

/**
 * Drop queue entries whose chat no longer exists in the database. The main
 * process owns the DB, so it is authoritative here — this avoids the JSON file
 * accumulating orphaned entries for deleted chats forever.
 */
export function pruneDeletedChats(data: PersistedQueue): PersistedQueue {
  const chatIds = Object.keys(data);
  if (chatIds.length === 0) {
    return data;
  }
  const existing = new Set(
    getDb()
      .select({ id: chats.id })
      .from(chats)
      .all()
      .map((row) => String(row.id)),
  );
  const pruned: PersistedQueue = {};
  for (const chatId of chatIds) {
    if (existing.has(chatId)) {
      pruned[chatId] = data[chatId];
    }
  }
  return pruned;
}
