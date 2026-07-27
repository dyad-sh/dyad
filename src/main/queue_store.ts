import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { z } from "zod";
import { getDyadAppPath } from "../paths/paths";
import { getDb } from "../db";
import { apps, chats } from "../db/schema";
import {
  PersistedQueuedMessageSchema,
  type PersistedQueue,
} from "../ipc/types/queue";

const logger = log.scope("queue_store");

const ChatQueueSchema = z.array(PersistedQueuedMessageSchema);

/**
 * Per-chat queued-prompt files live inside the app's Dyad-managed `.dyad/`
 * folder, mirroring how agent todos are persisted
 * (`<appPath>/.dyad/todos/<chatId>.json`). Keeping them here means they are
 * scoped to their app and cleaned up automatically when the app is deleted.
 *
 * Layout: `<appPath>/.dyad/queue/<chatId>.json`
 */
function getChatQueueDir(appPath: string): string {
  return path.join(appPath, ".dyad", "queue");
}

interface QueueFileRef {
  chatId: number;
  filePath: string;
}

/** Resolve the on-disk app directories for every app. */
function listAppPaths(): string[] {
  return getDb()
    .select({ path: apps.path })
    .from(apps)
    .all()
    .map((row) => getDyadAppPath(row.path));
}

/** Enumerate every existing per-chat queue file across all apps. */
async function listQueueFiles(): Promise<QueueFileRef[]> {
  const refs: QueueFileRef[] = [];
  for (const appPath of listAppPaths()) {
    const dir = getChatQueueDir(appPath);
    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      // Directory doesn't exist for this app (no queued prompts) — skip.
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const chatId = Number(entry.slice(0, -".json".length));
      if (!Number.isInteger(chatId)) continue;
      refs.push({ chatId, filePath: path.join(dir, entry) });
    }
  }
  return refs;
}

/**
 * Read the persisted queued prompts for all chats, keyed by chatId string.
 * Files belonging to chats that no longer exist are cleaned up. Never throws —
 * a corrupt or unreadable file is skipped so it can't crash startup.
 */
export async function readPersistedQueue(options?: {
  preserveLegacyFiles?: boolean;
}): Promise<PersistedQueue> {
  const result: PersistedQueue = {};
  const existingChatIds = new Set(
    getDb()
      .select({ id: chats.id })
      .from(chats)
      .all()
      .map((row) => row.id),
  );

  for (const ref of await listQueueFiles()) {
    if (!existingChatIds.has(ref.chatId)) {
      // The chat was deleted while its app remained — drop the orphan file.
      if (!options?.preserveLegacyFiles) await tryUnlink(ref.filePath);
      continue;
    }
    let raw: string;
    try {
      raw = await fs.promises.readFile(ref.filePath, "utf-8");
    } catch (error) {
      // Read failures may be transient (e.g. permissions) — keep the file.
      logger.error(`Error reading queue file ${ref.filePath}:`, error);
      continue;
    }
    try {
      const parsed = ChatQueueSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        logger.error(
          `Invalid queue file ${ref.filePath}, removing:`,
          parsed.error,
        );
        if (!options?.preserveLegacyFiles) await tryUnlink(ref.filePath);
        continue;
      }
      if (parsed.data.length > 0) {
        result[String(ref.chatId)] = parsed.data;
      }
    } catch (error) {
      // The content is provably corrupt — remove it so it doesn't log an
      // error on every startup forever.
      logger.error(`Corrupt queue file ${ref.filePath}, removing:`, error);
      if (!options?.preserveLegacyFiles) await tryUnlink(ref.filePath);
    }
  }
  return result;
}

async function tryUnlink(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn(`Failed to remove queue file ${filePath}:`, error);
    }
  }
}
