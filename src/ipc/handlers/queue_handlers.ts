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

const logger = log.scope("queue_handlers");

// Serializes queue writes. The renderer sends the full queue snapshot on every
// change and again on window teardown, so writes can arrive back-to-back;
// chaining them keeps the store's single-writer assumption intact and prevents
// a slower write from clobbering a newer snapshot on disk.
let writeChain: Promise<void> = Promise.resolve();

export function registerQueueHandlers() {
  createTypedHandler(queueContracts.getQueuedPrompts, async () => {
    // readPersistedQueue self-cleans orphan files for deleted chats.
    return readPersistedQueue();
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
