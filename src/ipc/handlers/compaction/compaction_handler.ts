/**
 * Context Compaction Handler
 * Orchestrates the compaction of long conversations to stay within context limits.
 */

import { IpcMainInvokeEvent } from "electron";
import { generateText, ModelMessage } from "ai";
import log from "electron-log";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { readSettings } from "@/main/settings";
import { getModelClient } from "@/ipc/utils/get_model_client";
import {
  getContextWindow,
  shouldTriggerCompaction,
} from "@/ipc/utils/token_utils";
import { safeSend } from "@/ipc/utils/safe_sender";
import { COMPACTION_SYSTEM_PROMPT } from "@/prompts/compaction_system_prompt";
import {
  storePreCompactionMessages,
  type CompactionMessage,
} from "./compaction_storage";
import { getProviderOptions, getAiHeaders } from "@/ipc/utils/provider_options";

const logger = log.scope("compaction_handler");

export interface CompactionResult {
  success: boolean;
  summary?: string;
  backupPath?: string;
  error?: string;
}

/**
 * Mark a chat as needing compaction before the next message.
 */
export async function markChatForCompaction(chatId: number): Promise<void> {
  try {
    await db
      .update(chats)
      .set({ pendingCompaction: true })
      .where(eq(chats.id, chatId));
    logger.info(`Marked chat ${chatId} for compaction`);
  } catch (error) {
    logger.error(`Failed to mark chat ${chatId} for compaction:`, error);
  }
}

/**
 * Check if a chat has pending compaction.
 */
export async function isChatPendingCompaction(
  chatId: number,
): Promise<boolean> {
  try {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      columns: { pendingCompaction: true },
    });
    return chat?.pendingCompaction === true;
  } catch (error) {
    logger.error(
      `Failed to check compaction status for chat ${chatId}:`,
      error,
    );
    return false;
  }
}

/**
 * Check if compaction should be triggered based on token usage.
 */
export async function checkAndMarkForCompaction(
  chatId: number,
  totalTokens: number,
): Promise<boolean> {
  const settings = readSettings();

  // Skip if compaction is disabled
  if (settings.enableContextCompaction === false) {
    return false;
  }

  const contextWindow = await getContextWindow();
  const shouldCompact = shouldTriggerCompaction(totalTokens, contextWindow);

  if (shouldCompact) {
    await markChatForCompaction(chatId);
    logger.info(
      `Compaction triggered for chat ${chatId}: ${totalTokens} tokens (threshold: ${Math.min(Math.floor(contextWindow * 0.8), 180_000)})`,
    );
    return true;
  }

  return false;
}

/**
 * Perform compaction on a chat.
 * This will:
 * 1. Load all messages from the chat
 * 2. Store original messages to backup file
 * 3. Generate a summary using the LLM
 * 4. Delete old messages from DB
 * 5. Insert summary message
 * 6. Update chat record
 */
export async function performCompaction(
  event: IpcMainInvokeEvent,
  chatId: number,
  dyadRequestId: string,
): Promise<CompactionResult> {
  const settings = readSettings();

  try {
    logger.info(`Starting compaction for chat ${chatId}`);

    // Load all messages for the chat
    const chatMessages = await db.query.messages.findMany({
      where: eq(messages.chatId, chatId),
      orderBy: (messages, { asc }) => [asc(messages.createdAt)],
    });

    if (chatMessages.length === 0) {
      logger.warn(`No messages found for chat ${chatId}, skipping compaction`);
      await clearPendingCompaction(chatId);
      return { success: true };
    }

    // Get the last message's token count
    const lastAssistantMessage = [...chatMessages]
      .reverse()
      .find((m) => m.role === "assistant" && m.maxTokensUsed);
    const totalTokens = lastAssistantMessage?.maxTokensUsed ?? 0;

    // Prepare messages for backup (exclude any previous compaction summaries)
    const messagesToBackup: CompactionMessage[] = chatMessages
      .filter((m) => !m.isCompactionSummary)
      .map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        createdAt: m.createdAt?.toISOString() ?? null,
        aiMessagesJson: m.aiMessagesJson,
      }));

    // Store backup first (fail-safe: don't delete without backup)
    const backupPath = await storePreCompactionMessages(
      chatId,
      messagesToBackup,
      totalTokens,
    );

    // Prepare conversation for summarization
    const conversationText = messagesToBackup
      .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join("\n\n---\n\n");

    // Get model client
    const { modelClient } = await getModelClient(
      settings.selectedModel,
      settings,
    );

    // Generate summary
    const summaryMessages: ModelMessage[] = [
      {
        role: "user",
        content: `Please summarize the following conversation:\n\n${conversationText}`,
      },
    ];

    const summaryResult = await generateText({
      model: modelClient.model,
      headers: getAiHeaders({
        builtinProviderId: modelClient.builtinProviderId,
      }),
      providerOptions: getProviderOptions({
        dyadAppId: 0,
        dyadRequestId,
        dyadDisableFiles: true,
        files: [],
        mentionedAppsCodebases: [],
        builtinProviderId: modelClient.builtinProviderId,
        settings,
      }),
      system: COMPACTION_SYSTEM_PROMPT,
      messages: summaryMessages,
      maxRetries: 2,
    });

    const summary = summaryResult.text;

    // Create the compaction indicator message
    const compactionMessageContent = `<dyad-status title="Conversation compacted" state="finished">
Previous conversation was compacted to save context space. Original messages have been preserved.
</dyad-status>

${summary}`;

    // Delete all non-summary messages for this chat
    // Since we're compacting the entire conversation, we delete all messages at once
    await db.delete(messages).where(eq(messages.chatId, chatId));

    // Insert summary message as a new assistant message
    await db.insert(messages).values({
      chatId,
      role: "assistant",
      content: compactionMessageContent,
      isCompactionSummary: true,
      createdAt: new Date(),
    });

    // Update chat record
    await db
      .update(chats)
      .set({
        compactedAt: new Date(),
        compactionBackupPath: backupPath,
        pendingCompaction: false,
      })
      .where(eq(chats.id, chatId));

    // Notify the frontend about the compaction
    safeSend(event.sender, "chat:compaction:complete", {
      chatId,
      backupPath,
    });

    logger.info(
      `Compaction completed for chat ${chatId}: ${messagesToBackup.length} messages -> 1 summary`,
    );

    return {
      success: true,
      summary,
      backupPath,
    };
  } catch (error) {
    logger.error(`Compaction failed for chat ${chatId}:`, error);

    // Clear pending flag to prevent infinite retry loops
    await clearPendingCompaction(chatId);

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Clear the pending compaction flag for a chat.
 */
async function clearPendingCompaction(chatId: number): Promise<void> {
  try {
    await db
      .update(chats)
      .set({ pendingCompaction: false })
      .where(eq(chats.id, chatId));
  } catch (error) {
    logger.error(
      `Failed to clear pending compaction for chat ${chatId}:`,
      error,
    );
  }
}
