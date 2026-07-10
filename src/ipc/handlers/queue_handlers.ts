import { createTypedHandler } from "./base";
import { queueContracts } from "../types/queue";
import {
  readPersistedQueue,
  writePersistedQueue,
} from "../../main/queue_store";

export function registerQueueHandlers() {
  createTypedHandler(queueContracts.getQueuedPrompts, async () => {
    // readPersistedQueue self-cleans orphan files for deleted chats.
    return readPersistedQueue();
  });

  createTypedHandler(queueContracts.setQueuedPrompts, async (_, queue) => {
    await writePersistedQueue(queue);
  });
}
