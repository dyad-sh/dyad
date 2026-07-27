import { ipcMain } from "electron";
import log from "electron-log";
import { createTypedHandler } from "./base";
import {
  queueContracts,
  queueSendContracts,
  PersistedQueueSchema,
} from "../types/queue";
import {
  readPersistedQueue,
  writePersistedQueue,
} from "../../main/queue_store";
import { db } from "@/db";
import { chatQueueEntries, chatQueueState } from "@/db/schema";
import { asc } from "drizzle-orm";
import { ChatQueueEntrySchema } from "@/chat_stream/transport";
import type { PersistedQueue } from "../types/queue";

const logger = log.scope("queue_handlers");

// Serializes queue writes. The renderer sends the full queue snapshot on every
// change and again on window teardown, so writes can arrive back-to-back;
// chaining them keeps the store's single-writer assumption intact and prevents
// a slower write from clobbering a newer snapshot on disk.
let writeChain: Promise<void> = Promise.resolve();

export function registerQueueHandlers() {
  createTypedHandler(queueContracts.getQueuedPrompts, async () => {
    const durable: PersistedQueue = {};
    for (const row of db
      .select({
        chatId: chatQueueEntries.chatId,
        payloadJson: chatQueueEntries.payloadJson,
      })
      .from(chatQueueEntries)
      .orderBy(asc(chatQueueEntries.chatId), asc(chatQueueEntries.position))
      .all()) {
      const entry = ChatQueueEntrySchema.parse(JSON.parse(row.payloadJson));
      (durable[String(row.chatId)] ??= []).push({
        id: entry.itemId,
        prompt: entry.prompt,
        attachments: entry.attachments,
        selectedComponents: entry.selectedComponents,
        redo: entry.redo,
        appId: entry.appId,
        requestedChatMode: entry.requestedChatMode,
      });
    }
    if (
      Object.keys(durable).length > 0 ||
      db.select({ chatId: chatQueueState.chatId }).from(chatQueueState).get()
    ) {
      return durable;
    }
    // Before the startup importer has run, retain read compatibility with the
    // old files. Production queue authority remains the SQLite aggregate.
    return readPersistedQueue({ preserveLegacyFiles: true });
  });

  // One-way (fire-and-forget) write — see queueSendContracts.setQueuedPrompts.
  // The renderer sends this from `pagehide` as the window is destroyed on quit;
  // because there is no reply, the main process never touches the dead frame.
  ipcMain?.on(
    queueSendContracts.setQueuedPrompts.channel,
    (_event, rawQueue: unknown) => {
      const parsed = PersistedQueueSchema.safeParse(rawQueue);
      if (!parsed.success) {
        logger.error(
          "Dropping invalid queued-prompt payload:",
          parsed.error.issues,
        );
        return;
      }
      writeChain = writeChain
        .catch(() => {})
        .then(() => writePersistedQueue(parsed.data))
        .catch((error) => {
          logger.error("Failed to persist queued prompts:", error);
        });
    },
  );
}
