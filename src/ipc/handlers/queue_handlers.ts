import { createTypedHandler } from "./base";
import { queueContracts } from "../types/queue";
import {
  readPersistedQueue,
  writePersistedQueue,
  pruneDeletedChats,
} from "../../main/queue_store";

export function registerQueueHandlers() {
  createTypedHandler(queueContracts.getQueuedPrompts, async () => {
    const persisted = readPersistedQueue();
    const pruned = pruneDeletedChats(persisted);
    // If pruning removed any entries (deleted chats), rewrite the cleaned file
    // so orphaned entries don't linger.
    if (Object.keys(pruned).length !== Object.keys(persisted).length) {
      writePersistedQueue(pruned);
    }
    return pruned;
  });

  createTypedHandler(queueContracts.setQueuedPrompts, async (_, queue) => {
    writePersistedQueue(queue);
  });
}
