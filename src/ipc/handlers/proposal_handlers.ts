import { type IpcMainInvokeEvent } from "electron";
import type {
  CodeProposal,
  ProposalResult,
  ActionProposal,
} from "../../lib/schemas";
import { db } from "../../db";
import { messages, chats } from "../../db/schema";
import { desc, eq, and } from "drizzle-orm";
import path from "node:path"; // Import path for basename
// Import tag parsers
import { processFullResponseActions } from "../processors/response_processor";
import {
  getDyadWriteTags,
  getDyadRenameTags,
  getDyadDeleteTags,
  getDyadExecuteSqlTags,
  getDyadAddDependencyTags,
  getDyadChatSummaryTag,
  getDyadCommandTags,
} from "../utils/dyad_tag_parser";
import log from "electron-log";
import { isServerFunction } from "../../supabase_admin/supabase_utils";
import {
  estimateMessagesTokens,
  estimateTokens,
  getContextWindow,
} from "../utils/token_utils";
import { extractCodebase } from "../../utils/codebase";
import { getDyadAppPath } from "../../paths/paths";
import { withLock } from "../utils/lock_utils";
import { createLoggedHandler } from "./safe_handle";
import { ApproveProposalResult } from "../ipc_types";
import { validateChatContext } from "../utils/context_paths_utils";
import { readSettings } from "@/main/settings";

const logger = log.scope("proposal_handlers");
const handle = createLoggedHandler(logger);
// Cache for codebase token counts
interface CodebaseTokenCache {
  chatId: number;
  messageId: number;
  messageContent: string;
  tokenCount: number;
  timestamp: number;
  chatContext: string;
}

// Cache expiration time (5 minutes)
const CACHE_EXPIRATION_MS = 5 * 60 * 1000;

// In-memory cache for codebase token counts
const codebaseTokenCache = new Map<number, CodebaseTokenCache>();

// Function to clean up expired cache entries
function cleanupExpiredCacheEntries() {
  const now = Date.now();
  let expiredCount = 0;

  codebaseTokenCache.forEach((entry, key) => {
    if (now - entry.timestamp > CACHE_EXPIRATION_MS) {
      codebaseTokenCache.delete(key);
      expiredCount++;
    }
  });

  if (expiredCount > 0) {
    logger.log(
      `Cleaned up ${expiredCount} expired codebase token cache entries`,
    );
  }
}

// Function to get cached token count or calculate and cache it
async function getCodebaseTokenCount(
  chatId: number,
  messageId: number,
  messageContent: string,
  appPath: string,
  chatContext: unknown,
): Promise<number> {
  // Clean up expired cache entries first
  cleanupExpiredCacheEntries();

  const cacheEntry = codebaseTokenCache.get(chatId);
  const now = Date.now();

  // Check if cache is valid - same chat, message and content, and not expired
  if (
    cacheEntry &&
    cacheEntry.messageId === messageId &&
    cacheEntry.messageContent === messageContent &&
    cacheEntry.chatContext === JSON.stringify(chatContext) &&
    now - cacheEntry.timestamp < CACHE_EXPIRATION_MS
  ) {
    logger.log(`Using cached codebase token count for chatId: ${chatId}`);
    return cacheEntry.tokenCount;
  }

  // Calculate and cache the token count
  logger.log(`Calculating codebase token count for chatId: ${chatId}`);
  const codebase = (
    await extractCodebase({
      appPath: getDyadAppPath(appPath),
      chatContext: validateChatContext(chatContext),
    })
  ).formattedOutput;
  const tokenCount = estimateTokens(codebase);

  // Store in cache
  codebaseTokenCache.set(chatId, {
    chatId,
    messageId,
    messageContent,
    tokenCount,
    timestamp: now,
    chatContext: JSON.stringify(chatContext),
  });

  return tokenCount;
}

const getProposalHandler = async (
  _event: IpcMainInvokeEvent,
  { chatId }: { chatId: number },
): Promise<ProposalResult | null> => {
  return withLock("get-proposal:" + chatId, async () => {
    logger.log(`IPC: get-proposal called for chatId: ${chatId}`);

    try {
      // Find the latest ASSISTANT message for the chat
      const latestAssistantMessage = await db.query.messages.findFirst({
        where: and(eq(messages.chatId, chatId), eq(messages.role, "assistant")),
        orderBy: [desc(messages.createdAt)],
        columns: {
          id: true, // Fetch the ID
          content: true, // Fetch the content to parse
          approvalState: true,
        },
      });

      if (
        latestAssistantMessage?.content &&
        latestAssistantMessage.id &&
        !latestAssistantMessage?.approvalState
      ) {
        const messageId = latestAssistantMessage.id; // Get the message ID
        logger.log(
          `Found latest assistant message (ID: ${messageId}), parsing content...`,
        );
        const messageContent = latestAssistantMessage.content;

        const proposalTitle = getDyadChatSummaryTag(messageContent);

        const proposalWriteFiles = getDyadWriteTags(messageContent);
        const proposalRenameFiles = getDyadRenameTags(messageContent);
        const proposalDeleteFiles = getDyadDeleteTags(messageContent);
        const proposalExecuteSqlQueries = getDyadExecuteSqlTags(messageContent);
        const packagesAdded = getDyadAddDependencyTags(messageContent);

        const filesChanged = [
          ...proposalWriteFiles.map((tag) => ({
            name: path.basename(tag.path),
            path: tag.path,
            summary: tag.description ?? "(no change summary found)", // Generic summary
            type: "write" as const,
            isServerFunction: isServerFunction(tag.path),
          })),
          ...proposalRenameFiles.map((tag) => ({
            name: path.basename(tag.to),
            path: tag.to,
            summary: `Rename from ${tag.from} to ${tag.to}`,
            type: "rename" as const,
            isServerFunction: isServerFunction(tag.to),
          })),
          ...proposalDeleteFiles.map((tag) => ({
            name: path.basename(tag),
            path: tag,
            summary: `Delete file`,
            type: "delete" as const,
            isServerFunction: isServerFunction(tag),
          })),
        ];
        // Check if we have enough information to create a proposal
        if (
          filesChanged.length > 0 ||
          packagesAdded.length > 0 ||
          proposalExecuteSqlQueries.length > 0
        ) {
          const proposal: CodeProposal = {
            type: "code-proposal",
            // Use parsed title or a default title if summary tag is missing but write tags exist
            title: proposalTitle ?? "Proposed File Changes",
            securityRisks: [], // Keep empty
            filesChanged,
            packagesAdded,
            sqlQueries: proposalExecuteSqlQueries.map((query) => ({
              content: query.content,
              description: query.description,
            })),
          };
          logger.log(
            "Generated code proposal. title=",
            proposal.title,
            "files=",
            proposal.filesChanged.length,
            "packages=",
            proposal.packagesAdded.length,
          );

          return {
            proposal: proposal,
            chatId,
            messageId,
          };
        } else {
          logger.log(
            "No relevant tags found in the latest assistant message content.",
          );
        }
      }
      const actions: ActionProposal["actions"] = [];
      if (latestAssistantMessage?.content) {
        const writeTags = getDyadWriteTags(latestAssistantMessage.content);
        const refactorTarget = writeTags.reduce(
          (largest, tag) => {
            const lineCount = tag.content.split("\n").length;
            return lineCount > 500 &&
              (!largest || lineCount > largest.lineCount)
              ? { path: tag.path, lineCount }
              : largest;
          },
          null as { path: string; lineCount: number } | null,
        );
        if (refactorTarget) {
          actions.push({
            id: "refactor-file",
            path: refactorTarget.path,
          });
        }
        if (
          writeTags.length === 0 &&
          latestAssistantMessage.content.includes("```")
        ) {
          actions.push({
            id: "write-code-properly",
          });
        }

        // Check for command tags and add corresponding actions
        const commandTags = getDyadCommandTags(latestAssistantMessage.content);
        if (commandTags.includes("rebuild")) {
          actions.push({
            id: "rebuild",
          });
        }
        if (commandTags.includes("restart")) {
          actions.push({
            id: "restart",
          });
        }
        if (commandTags.includes("refresh")) {
          actions.push({
            id: "refresh",
          });
        }
      }

      // Get all chat messages to calculate token usage
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, chatId),
        with: {
          app: true,
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
          },
        },
      });

      if (latestAssistantMessage && chat) {
        // Calculate total tokens from message history
        const messagesTokenCount = estimateMessagesTokens(chat.messages);

        // Use cached token count or calculate new one
        const codebaseTokenCount = await getCodebaseTokenCount(
          chatId,
          latestAssistantMessage.id,
          latestAssistantMessage.content || "",
          chat.app.path,
          chat.app.chatContext,
        );

        const totalTokens = messagesTokenCount + codebaseTokenCount;
        const contextWindow = Math.min(await getContextWindow(), 100_000);
        logger.log(
          `Token usage: ${totalTokens}/${contextWindow} (${
            (totalTokens / contextWindow) * 100
          }%)`,
        );

        // If we're using more than 80% of the context window, suggest summarizing
        if (totalTokens > contextWindow * 0.8 || chat.messages.length > 10) {
          logger.log(
            `Token usage is high (${totalTokens}/${contextWindow}) OR long chat history (${chat.messages.length} messages), suggesting summarize action`,
          );
          actions.push({
            id: "summarize-in-new-chat",
          });
        }
      }
      if (latestAssistantMessage) {
        actions.push({
          id: "keep-going",
        });
        return {
          proposal: {
            type: "action-proposal",
            actions: actions,
          },
          chatId,
          messageId: latestAssistantMessage.id,
        };
      }
      return null;
    } catch (error) {
      logger.error(`Error processing proposal for chatId ${chatId}:`, error);
      return null; // Indicate DB or processing error
    }
  });
};

// Handler to approve a proposal (process actions and update message)
const approveProposalHandler = async (
  _event: IpcMainInvokeEvent,
  { chatId, messageId }: { chatId: number; messageId: number },
): Promise<ApproveProposalResult> => {
  const settings = readSettings();
  if (settings.selectedChatMode === "ask") {
    throw new Error(
      "Ask mode is not supported for proposal approval. Please switch to build mode.",
    );
  }
  // 1. Fetch the specific assistant message
  const messageToApprove = await db.query.messages.findFirst({
    where: and(
      eq(messages.id, messageId),
      eq(messages.chatId, chatId),
      eq(messages.role, "assistant"),
    ),
    columns: {
      content: true,
    },
  });

  if (!messageToApprove?.content) {
    throw new Error(
      `Assistant message not found for chatId: ${chatId}, messageId: ${messageId}`,
    );
  }

  // 2. Process the actions defined in the message content
  const chatSummary = getDyadChatSummaryTag(messageToApprove.content);
  const processResult = await processFullResponseActions(
    messageToApprove.content,
    chatId,
    {
      chatSummary: chatSummary ?? undefined,
      messageId,
    }, // Pass summary if found
  );

  if (processResult.error) {
    throw new Error(
      `Error processing actions for message ${messageId}: ${processResult.error}`,
    );
  }

  return {
    extraFiles: processResult.extraFiles,
    extraFilesError: processResult.extraFilesError,
  };
};

// Handler to reject a proposal (just update message state)
const rejectProposalHandler = async (
  _event: IpcMainInvokeEvent,
  { chatId, messageId }: { chatId: number; messageId: number },
): Promise<void> => {
  logger.log(
    `IPC: reject-proposal called for chatId: ${chatId}, messageId: ${messageId}`,
  );

  // 1. Verify the message exists and is an assistant message
  const messageToReject = await db.query.messages.findFirst({
    where: and(
      eq(messages.id, messageId),
      eq(messages.chatId, chatId),
      eq(messages.role, "assistant"),
    ),
    columns: { id: true },
  });

  if (!messageToReject) {
    throw new Error(
      `Assistant message not found for chatId: ${chatId}, messageId: ${messageId}`,
    );
  }

  // 2. Update the message's approval state to 'rejected'
  await db
    .update(messages)
    .set({ approvalState: "rejected" })
    .where(eq(messages.id, messageId));

  logger.log(`Message ${messageId} marked as rejected.`);
};

// Function to register proposal-related handlers
export function registerProposalHandlers() {
  handle("get-proposal", getProposalHandler);
  handle("approve-proposal", approveProposalHandler);
  handle("reject-proposal", rejectProposalHandler);
}
