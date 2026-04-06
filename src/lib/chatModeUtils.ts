import { ipc } from "@/ipc/types";
import { ChatMode } from "@/lib/schemas";
import log from "electron-log";

const logger = log.scope("chatModeUtils");

/**
 * Persist a chat mode change to the database.
 * Returns true if successful, false if failed.
 * This helper prevents duplication of the fire-and-forget pattern used in other components like  (ChatModeSelector, useChatModeToggle, etc.)
 */
export async function persistChatModeToDb(
  chatId: number,
  chatMode: ChatMode,
  onSuccess?: () => void | Promise<void>,
  onError?: (error: unknown) => void | Promise<void>,
): Promise<boolean> {
  try {
    await ipc.chat.updateChatMode({ chatId, chatMode });
    if (onSuccess) {
      await Promise.resolve(onSuccess());
    }
    return true;
  } catch (error) {
    logger.error("Error persisting chat mode to database:", error);
    if (onError) {
      await Promise.resolve(onError(error));
    }
    return false;
  }
}
