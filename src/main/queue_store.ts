import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { getDyadAppPath } from "../paths/paths";
import { getDb } from "../db";
import { apps, chats } from "../db/schema";
import { ensureDyadGitignored } from "../ipc/handlers/gitignoreUtils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
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

function getChatQueueFilePath(appPath: string, chatId: number): string {
  return path.join(getChatQueueDir(appPath), `${chatId}.json`);
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
export async function readPersistedQueue(): Promise<PersistedQueue> {
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
      await tryUnlink(ref.filePath);
      continue;
    }
    try {
      const raw = await fs.promises.readFile(ref.filePath, "utf-8");
      const parsed = ChatQueueSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        logger.error(
          `Invalid queue file ${ref.filePath}, ignoring:`,
          parsed.error,
        );
        continue;
      }
      if (parsed.data.length > 0) {
        result[String(ref.chatId)] = parsed.data;
      }
    } catch (error) {
      logger.error(`Error reading queue file ${ref.filePath}:`, error);
    }
  }
  return result;
}

/**
 * Persist the queued prompts for all chats. Each chat's prompts are written to
 * its own `<appPath>/.dyad/queue/<chatId>.json`; chats absent from `data`
 * (completed / cleared / deleted) have their file removed.
 */
export async function writePersistedQueue(data: PersistedQueue): Promise<void> {
  const incomingChatIds = new Set(
    Object.keys(data)
      .map(Number)
      .filter((id) => Number.isInteger(id)),
  );

  // Remove files for chats that are no longer queued.
  for (const ref of await listQueueFiles()) {
    if (!incomingChatIds.has(ref.chatId)) {
      await tryUnlink(ref.filePath);
    }
  }

  if (incomingChatIds.size === 0) return;

  // Resolve each incoming chat's app directory in a single query.
  const appPathByChatId = new Map<number, string>();
  const rows = getDb()
    .select({ chatId: chats.id, appPath: apps.path })
    .from(chats)
    .innerJoin(apps, eq(chats.appId, apps.id))
    .where(inArray(chats.id, [...incomingChatIds]))
    .all();
  for (const row of rows) {
    appPathByChatId.set(row.chatId, getDyadAppPath(row.appPath));
  }

  const writtenAppPaths = new Set<string>();
  for (const [chatIdStr, items] of Object.entries(data)) {
    if (items.length === 0) continue;
    const chatId = Number(chatIdStr);
    const appPath = appPathByChatId.get(chatId);
    if (!appPath) {
      logger.warn(`Skipping queue persist for unknown chat ${chatId}`);
      continue;
    }
    await writeChatQueueFile(appPath, chatId, items);
    writtenAppPaths.add(appPath);
  }

  // Ensure `.dyad/` stays out of the user's git repo (idempotent). The queue
  // may write here before the agent — which normally does this — ever runs.
  await Promise.all(
    [...writtenAppPaths].map((appPath) =>
      ensureDyadGitignored(appPath).catch((err: unknown) =>
        logger.warn(`Failed to ensure .dyad gitignored for ${appPath}:`, err),
      ),
    ),
  );
}

async function writeChatQueueFile(
  appPath: string,
  chatId: number,
  items: PersistedQueue[string],
): Promise<void> {
  const dir = getChatQueueDir(appPath);
  const filePath = getChatQueueFilePath(appPath, chatId);
  // Atomic write (temp-file + rename) so a crash mid-write can't corrupt the file.
  // Async I/O keeps the Electron main thread responsive while writing large
  // base64 attachment payloads.
  const tempFilePath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(tempFilePath, JSON.stringify(items, null, 2));
    await fs.promises.rename(tempFilePath, filePath);
  } catch (error) {
    await tryUnlink(tempFilePath);
    // Surface disk-full / permission failures as a classified DyadError so
    // telemetry treats them as environmental rather than a product bug.
    throw new DyadError(
      `Failed to write queued prompts for chat ${chatId}: ${
        (error as Error).message
      }`,
      DyadErrorKind.External,
      { cause: error },
    );
  }
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
