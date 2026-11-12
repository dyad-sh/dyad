/**
 * Context Compaction Handler
 * Orchestrates the compaction of long conversations to stay within context limits.
 */

import fs from "node:fs";
import path from "node:path";
import { getAuxiliarySettings } from "@/lib/auxiliaryModel";
import { IpcMainInvokeEvent } from "electron";
import { streamText, ModelMessage } from "ai";
import log from "electron-log";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { readSettings } from "@/main/settings";
import { getChatInferenceSettings } from "@/ipc/services/chat_inference_settings";
import { SMALL_MODEL_NAME } from "@/ipc/shared/language_model_constants";
import type { UserSettings } from "@/lib/schemas";
import { getModelClient } from "@/ipc/utils/get_model_client";
import {
  getCompactionThreshold,
  getContextWindow,
  shouldTriggerCompaction,
} from "@/ipc/utils/token_utils";
import { safeSend } from "@/ipc/utils/safe_sender";
import {
  cancelOrphanedBaseStream,
  fastTextOutput,
} from "@/ipc/utils/stream_text_utils";
import { COMPACTION_SYSTEM_PROMPT } from "@/prompts/compaction_system_prompt";
import {
  storePreCompactionMessages,
  formatAsTranscript,
  type CompactionMessage,
} from "./compaction_storage";
import { buildCompactionBlock } from "./compaction_utils";
import { loadPostCompactionTranscript } from "@/ipc/utils/chat_history_loader";
import {
  getProviderOptions,
  getAiHeaders,
  DYAD_INTERNAL_REQUEST_ID_HEADER,
} from "@/ipc/utils/provider_options";
import { isDyadProEnabled } from "@/lib/schemas";
import {
  normalizeModelSelection,
  resolveDefaultModelSelection,
  resolveModelSelection,
} from "@/ipc/utils/model_effort";
import { getModelPreferenceKey } from "@/lib/modelEffort";

const logger = log.scope("compaction_handler");

// Pinned compaction model for Pro users. Benchmarked against gpt-5.6-sol on
// ~200k-token transcripts (plans/benchmark-compaction.md): equal summary
// quality at ~2x lower latency, which matters because compaction blocks the
// turn mid-stream. Matches the durable Explorer persona model.
// Non-Pro users keep their selected chat model — the pinned model is only
// reachable through the Dyad Engine gateway.
const PRO_COMPACTION_MODEL = {
  provider: "openai",
  name: SMALL_MODEL_NAME,
} as const;

export interface CompactionResult {
  success: boolean;
  aborted?: boolean;
  skipped?: boolean;
  summary?: string;
  backupPath?: string;
  error?: string;
}

// The DB flag is the durable "owed a compaction" record and is only cleared
// after success. This in-memory guard prevents duplicate work within this
// process without sacrificing retry-on-failure or abort-retains-mark semantics.
const compactionChatsInFlight = new Set<number>();

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
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
    columns: { modelSelection: true },
  });
  const selectedModel = chat?.modelSelection
    ? await normalizeModelSelection(chat.modelSelection)
    : await resolveDefaultModelSelection(settings);

  // Skip if compaction is disabled
  if (settings.enableContextCompaction === false) {
    return false;
  }

  const contextWindow = await getContextWindow(selectedModel);
  const provider = selectedModel.provider;
  const shouldCompact = shouldTriggerCompaction(
    totalTokens,
    contextWindow,
    provider,
  );

  if (shouldCompact) {
    await markChatForCompaction(chatId);
    logger.info(
      `Compaction triggered for chat ${chatId}: ${totalTokens} tokens (threshold: ${getCompactionThreshold(contextWindow, provider)})`,
    );
    return true;
  }

  return false;
}

/**
 * Perform compaction on a chat.
 * This will:
 * 1. Load all messages from the chat
 * 2. Find the latest compaction boundary (if re-compacting)
 * 3. Store LLM-visible messages to a readable backup file
 * 4. Generate a summary using the LLM
 * 5. Insert summary message (original messages are preserved in DB)
 * 6. Update chat record
 */
export async function performCompaction(
  event: IpcMainInvokeEvent,
  chatId: number,
  appPath: string,
  dyadRequestId: string,
  onSummaryChunk?: (accumulatedText: string) => void,
  options?: {
    createdAtStrategy?: "before-latest-user" | "now";
    abortSignal?: AbortSignal;
    settingsOverride?: UserSettings;
    /**
     * The app's own folder when `appPath` is a chat's worktree: the backup
     * is also kept there, so it outlives the worktree (later worktrees get it
     * mirrored in).
     */
    durableAppPath?: string;
  },
): Promise<CompactionResult> {
  const abortSignal = options?.abortSignal;
  const abortedResult = (): CompactionResult => ({
    success: false,
    aborted: true,
    error: "Compaction aborted",
  });

  if (abortSignal?.aborted) {
    return abortedResult();
  }

  // Check and acquire in one synchronous frame, before the first await in the
  // compaction path. A concurrent loser skips silently while the winner owns
  // the durable pending mark.
  if (compactionChatsInFlight.has(chatId)) {
    return { success: false, skipped: true };
  }
  compactionChatsInFlight.add(chatId);

  try {
    const storedSettings = await getChatInferenceSettings(
      chatId,
      options?.settingsOverride,
    );
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      columns: { modelSelection: true },
    });
    const selectedModel =
      options?.settingsOverride && storedSettings.proModelUsage === "api-key"
        ? await resolveDefaultModelSelection(storedSettings)
        : chat?.modelSelection
          ? await normalizeModelSelection(chat.modelSelection)
          : await resolveDefaultModelSelection(storedSettings);
    // Stored connections describe an earlier turn, not this auxiliary request.
    const { connection: _connection, ...modelIdentity } = selectedModel;
    const compactionModel = isDyadProEnabled(storedSettings)
      ? await resolveModelSelection({
          model: PRO_COMPACTION_MODEL,
          preferredEffortLevel:
            storedSettings.modelEffortPreferences?.[
              getModelPreferenceKey(PRO_COMPACTION_MODEL)
            ],
        })
      : modelIdentity;
    const settings = {
      ...getAuxiliarySettings(storedSettings),
      selectedModel: compactionModel,
    };
    logger.info(`Starting compaction for chat ${chatId}`);

    // Only operate on messages the LLM can currently see.
    const llmVisibleMessages = await loadPostCompactionTranscript(chatId);

    if (llmVisibleMessages.length === 0) {
      logger.warn(`No messages found for chat ${chatId}, skipping compaction`);
      await clearPendingCompaction(chatId);
      return { success: true };
    }

    // Prepare messages for backup
    const messagesToBackup: CompactionMessage[] = llmVisibleMessages.map(
      (m) => ({ role: m.role, content: m.content }),
    );

    // The same transcript is the readable backup in the app's .dyad/chats/
    // directory and the conversation sent for summarization.
    const conversationText = formatAsTranscript(messagesToBackup, chatId);
    const backupPath = await storePreCompactionMessages(
      appPath,
      chatId,
      conversationText,
      messagesToBackup.length,
    );
    const durableAppPath = options?.durableAppPath;
    if (durableAppPath && durableAppPath !== appPath) {
      const durableBackup = path.join(durableAppPath, backupPath);
      try {
        await fs.promises.mkdir(path.dirname(durableBackup), {
          recursive: true,
        });
        await fs.promises.copyFile(
          path.join(appPath, backupPath),
          durableBackup,
        );
      } catch (error) {
        // The summary will point at this backup, and the worktree copy goes
        // when the workspace is deleted: stay pending and retry instead.
        logger.error("Failed to keep the compaction backup in the app", error);
        throw error;
      }
    }

    // Get model client
    const { modelClient } = await getModelClient(
      compactionModel,
      settings,
      compactionModel,
    );

    // Generate summary
    const summaryMessages: ModelMessage[] = [
      {
        role: "user",
        content: `Please summarize the following conversation:\n\n${conversationText}`,
      },
    ];

    const summaryResult = streamText({
      output: fastTextOutput(),
      model: modelClient.model,
      headers: {
        ...getAiHeaders({
          builtinProviderId: modelClient.builtinProviderId,
        }),
        [DYAD_INTERNAL_REQUEST_ID_HEADER]: dyadRequestId,
      },
      providerOptions: getProviderOptions({
        dyadAppId: 0,
        dyadRequestId,
        dyadDisableFiles: true,
        files: [],
        mentionedAppsCodebases: [],
        builtinProviderId: modelClient.builtinProviderId,
        reasoningEffortProviderId: modelClient.reasoningEffortProviderId,
        modelSelection: compactionModel,
      }),
      system: COMPACTION_SYSTEM_PROMPT,
      messages: summaryMessages,
      maxRetries: 2,
      abortSignal,
    });

    // Read .textStream now (not lazily) so the SDK's tee runs
    // synchronously, then cancel the orphaned branch before any chunks
    // are pumped. See `cancelOrphanedBaseStream` for why this is required.
    const textStream = summaryResult.textStream;
    cancelOrphanedBaseStream(summaryResult);

    // Stream summary text to the frontend as it generates
    let summary = "";
    for await (const chunk of textStream) {
      if (abortSignal?.aborted) {
        return abortedResult();
      }
      summary += chunk;
      onSummaryChunk?.(summary);
    }

    if (abortSignal?.aborted) {
      return abortedResult();
    }

    // Create the compaction indicator message
    // Include relative backup path so the AI can read the full original conversation later
    const compactionMessageContent = `${buildCompactionBlock(summary)}

If you need to retrieve earlier parts of the conversation history, you can read the backup file at: ${backupPath}
Note: This file may be large. Read only the sections you need or use grep to search for specific content rather than reading the entire file.`;

    // Insert summary message as a new assistant message
    // Original messages are preserved in the DB for the user to see
    //
    // The createdAt timestamp must be set BEFORE the latest user message
    // (the one that triggered compaction). This is critical because:
    // 1. Messages are ordered by createdAt, and the compaction summary must
    //    appear before the new user message in the message array.
    // 2. The local_agent_handler slices from the last compaction summary onward
    //    to build the LLM's message history — if the summary comes after the
    //    user message, the user's prompt is excluded from the LLM context.
    // 3. sendResponseChunk updates the last assistant message, so the summary
    //    must not be the last assistant message (the placeholder should be).
    const latestUserMessage = [...llmVisibleMessages]
      .reverse()
      .find((m) => m.role === "user");
    const compactionCreatedAt =
      options?.createdAtStrategy === "now"
        ? new Date()
        : latestUserMessage
          ? new Date(latestUserMessage.createdAt.getTime() - 1000)
          : new Date();
    await db.insert(messages).values({
      chatId,
      role: "assistant",
      content: compactionMessageContent,
      isCompactionSummary: true,
      createdAt: compactionCreatedAt,
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
      `Compaction completed for chat ${chatId}: ${messagesToBackup.length} messages -> 1 summary (originals preserved)`,
    );

    return {
      success: true,
      summary,
      backupPath,
    };
  } catch (error) {
    if (abortSignal?.aborted) {
      return abortedResult();
    }

    logger.error(`Compaction failed for chat ${chatId}:`, error);

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    compactionChatsInFlight.delete(chatId);
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
