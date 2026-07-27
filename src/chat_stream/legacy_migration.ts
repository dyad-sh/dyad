import log from "electron-log";
import { db } from "@/db";
import { readPersistedQueue } from "@/main/queue_store";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import { importLegacyChatQueue } from "./persistence";
import type { SerializableChatTurnIntent } from "./transport";

const logger = log.scope("chat_queue_migration");

/**
 * One-time import from renderer-owned `.dyad/queue` files.
 *
 * Legacy files stay untouched as rollback evidence. Each chat imports in one
 * transaction and restored work is paused for explicit review.
 */
export async function migrateLegacyChatQueues(): Promise<void> {
  const legacy = await readPersistedQueue({ preserveLegacyFiles: true });
  for (const [chatIdText, entries] of Object.entries(legacy)) {
    const chatId = Number(chatIdText);
    try {
      const intents = entries
        .filter((entry) => entry.userInputRequestId === undefined)
        .map((entry): SerializableChatTurnIntent => {
          const withoutHash = {
            schemaVersion: 1 as const,
            intentId: entry.id,
            chatId,
            invocationRef: {
              kind: "chat-stream" as const,
              entityKey: chatId,
              operationId: `${entry.id}:legacy`,
            },
            prompt: entry.prompt,
            attachments: entry.attachments,
            selectedComponents: entry.selectedComponents,
            redo: entry.redo,
            appId: entry.appId,
            requestedChatMode: entry.requestedChatMode,
          };
          return {
            ...withoutHash,
            payloadHash: computeChatTurnPayloadHash(withoutHash),
          };
        });
      importLegacyChatQueue(db, chatId, intents);
    } catch (error) {
      logger.error(
        `Failed to import legacy queue for chat ${chatId}; retaining source file`,
        error,
      );
    }
  }
}
