import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type {
  CodeProposal,
  FileChange,
  ProposalResult,
  SqlQuery,
} from "../../lib/schemas";
import { db } from "../../db";
import { messages } from "../../db/schema";
import { desc, eq, and, Update } from "drizzle-orm";
import path from "node:path"; // Import path for basename
// Import tag parsers
import {
  getDyadAddDependencyTags,
  getDyadChatSummaryTag,
  getDyadDeleteTags,
  getDyadExecuteSqlTags,
  getDyadRenameTags,
  getDyadWriteTags,
  processFullResponseActions,
} from "../processors/response_processor";
import log from "electron-log";
import { isServerFunction } from "../../supabase_admin/supabase_utils";

const logger = log.scope("proposal_handlers");

// Placeholder Proposal data (can be removed or kept for reference)
// const placeholderProposal: Proposal = { ... };

// Type guard for the parsed proposal structure
interface ParsedProposal {
  title: string;
  files: string[];
}
function isParsedProposal(obj: any): obj is ParsedProposal {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.title === "string" &&
    Array.isArray(obj.files) &&
    obj.files.every((file: any) => typeof file === "string")
  );
}

const getProposalHandler = async (
  _event: IpcMainInvokeEvent,
  { chatId }: { chatId: number }
): Promise<ProposalResult | null> => {
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

    if (latestAssistantMessage?.approvalState === "rejected") {
      return null;
    }
    if (latestAssistantMessage?.approvalState === "approved") {
      return null;
    }

    if (latestAssistantMessage?.content && latestAssistantMessage.id) {
      const messageId = latestAssistantMessage.id; // Get the message ID
      logger.log(
        `Found latest assistant message (ID: ${messageId}), parsing content...`
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
          proposal.packagesAdded.length
        );
        return { proposal, chatId, messageId }; // Return proposal and messageId
      } else {
        logger.log(
          "No relevant tags found in the latest assistant message content."
        );
        return null; // No proposal could be generated
      }
    } else {
      logger.log(`No assistant message found for chatId: ${chatId}`);
      return null; // No message found
    }
  } catch (error) {
    logger.error(`Error processing proposal for chatId ${chatId}:`, error);
    return null; // Indicate DB or processing error
  }
};

// Handler to approve a proposal (process actions and update message)
const approveProposalHandler = async (
  _event: IpcMainInvokeEvent,
  { chatId, messageId }: { chatId: number; messageId: number }
): Promise<{ success: boolean; error?: string }> => {
  logger.log(
    `IPC: approve-proposal called for chatId: ${chatId}, messageId: ${messageId}`
  );

  try {
    // 1. Fetch the specific assistant message
    const messageToApprove = await db.query.messages.findFirst({
      where: and(
        eq(messages.id, messageId),
        eq(messages.chatId, chatId),
        eq(messages.role, "assistant")
      ),
      columns: {
        content: true,
      },
    });

    if (!messageToApprove?.content) {
      logger.error(
        `Assistant message not found for chatId: ${chatId}, messageId: ${messageId}`
      );
      return { success: false, error: "Assistant message not found." };
    }

    // 2. Process the actions defined in the message content
    const chatSummary = getDyadChatSummaryTag(messageToApprove.content);
    const processResult = await processFullResponseActions(
      messageToApprove.content,
      chatId,
      {
        chatSummary: chatSummary ?? undefined,
        messageId,
      } // Pass summary if found
    );

    if (processResult.error) {
      logger.error(
        `Error processing actions for message ${messageId}:`,
        processResult.error
      );
      // Optionally: Update message state to 'error' or similar?
      // For now, just return error to frontend
      return {
        success: false,
        error: `Action processing failed: ${processResult.error}`,
      };
    }

    return { success: true };
  } catch (error) {
    logger.error(`Error approving proposal for messageId ${messageId}:`, error);
    return {
      success: false,
      error: (error as Error)?.message || "Unknown error",
    };
  }
};

// Handler to reject a proposal (just update message state)
const rejectProposalHandler = async (
  _event: IpcMainInvokeEvent,
  { chatId, messageId }: { chatId: number; messageId: number }
): Promise<{ success: boolean; error?: string }> => {
  logger.log(
    `IPC: reject-proposal called for chatId: ${chatId}, messageId: ${messageId}`
  );

  try {
    // 1. Verify the message exists and is an assistant message
    const messageToReject = await db.query.messages.findFirst({
      where: and(
        eq(messages.id, messageId),
        eq(messages.chatId, chatId),
        eq(messages.role, "assistant")
      ),
      columns: { id: true }, // Only need to confirm existence
    });

    if (!messageToReject) {
      logger.error(
        `Assistant message not found for chatId: ${chatId}, messageId: ${messageId}`
      );
      return { success: false, error: "Assistant message not found." };
    }

    // 2. Update the message's approval state to 'rejected'
    await db
      .update(messages)
      .set({ approvalState: "rejected" })
      .where(eq(messages.id, messageId));

    logger.log(`Message ${messageId} marked as rejected.`);
    return { success: true };
  } catch (error) {
    logger.error(`Error rejecting proposal for messageId ${messageId}:`, error);
    return {
      success: false,
      error: (error as Error)?.message || "Unknown error",
    };
  }
};

// Function to register proposal-related handlers
export function registerProposalHandlers() {
  ipcMain.handle("get-proposal", getProposalHandler);
  ipcMain.handle("approve-proposal", approveProposalHandler);
  ipcMain.handle("reject-proposal", rejectProposalHandler);
}
