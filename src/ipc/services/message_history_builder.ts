import log from "electron-log";
import { filterCancelledMessagePairs } from "@/shared/chatCancellation";
import {
  removeDyadTags,
  removeNonEssentialTags,
} from "../utils/chat_response_utils";

const logger = log.scope("message_history_builder");

export interface HistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
  sourceCommitHash?: string | null;
  commitHash?: string | null;
}

export interface ChatHistoryModelMessage {
  role: "user" | "assistant" | "system";
  content: string;
  providerOptions: {
    "dyad-engine": {
      sourceCommitHash: string | null | undefined;
      commitHash: string | null | undefined;
    };
  };
}

/**
 * Builds the AI-facing message history from raw chat messages (Phase 2
 * extraction from chat_stream_handlers.ts). Pure: no db/fs access.
 *
 * Steps, in order:
 * 1. Filter out cancelled message pairs so the AI doesn't reconcile
 *    cancelled prompts with new ones.
 * 2. Optionally replace the last user message content: the DB stores
 *    display-friendly versions (short /implement-plan= form or clean
 *    <dyad-attachment> tags); the model needs the expanded AI prompt.
 * 3. Limit history to the most recent `maxChatTurns` turns, ensuring the
 *    kept window starts with a user message.
 */
export function buildMessageHistory({
  messages,
  replaceLastUserMessageWith,
  maxChatTurns,
}: {
  messages: HistoryMessage[];
  /** When set, the content of the most recent user message is replaced. */
  replaceLastUserMessageWith?: string;
  maxChatTurns: number;
}): HistoryMessage[] {
  const messageHistory = filterCancelledMessagePairs(messages);

  if (replaceLastUserMessageWith !== undefined) {
    for (let i = messageHistory.length - 1; i >= 0; i--) {
      if (messageHistory[i].role === "user") {
        messageHistory[i] = {
          ...messageHistory[i],
          content: replaceLastUserMessageWith,
        };
        break;
      }
    }
  }

  // If we need to limit the context, we take only the most recent turns
  let limitedMessageHistory = messageHistory;
  if (messageHistory.length > maxChatTurns * 2) {
    // Each turn is a user + assistant pair
    // Calculate how many messages to keep (maxChatTurns * 2)
    let recentMessages = messageHistory
      .filter((msg) => msg.role !== "system")
      .slice(-maxChatTurns * 2);

    // Ensure the first message is a user message
    if (recentMessages.length > 0 && recentMessages[0].role !== "user") {
      // Find the first user message
      const firstUserIndex = recentMessages.findIndex(
        (msg) => msg.role === "user",
      );
      if (firstUserIndex > 0) {
        // Drop assistant messages before the first user message
        recentMessages = recentMessages.slice(firstUserIndex);
      } else if (firstUserIndex === -1) {
        logger.warn(
          "No user messages found in recent history, set recent messages to empty",
        );
        recentMessages = [];
      }
    }

    limitedMessageHistory = [...recentMessages];

    logger.log(
      `Limiting chat history from ${messageHistory.length} to ${limitedMessageHistory.length} messages (max ${maxChatTurns} turns)`,
    );
  }

  return limitedMessageHistory;
}

/**
 * Maps limited history into model messages, stripping tags that waste
 * tokens (thinking/problem reports always; all dyad tags in ask mode) and
 * threading commit hashes through provider options for the Dyad engine.
 */
export function toHistoryChatMessages({
  history,
  selectedChatMode,
}: {
  history: HistoryMessage[];
  selectedChatMode: string;
}): ChatHistoryModelMessage[] {
  return history.map((msg) => ({
    role: msg.role,
    // Why remove thinking tags?
    // Thinking tags are generally not critical for the context
    // and eats up extra tokens.
    content:
      selectedChatMode === "ask"
        ? removeDyadTags(removeNonEssentialTags(msg.content))
        : removeNonEssentialTags(msg.content),
    providerOptions: {
      "dyad-engine": {
        sourceCommitHash: msg.sourceCommitHash,
        commitHash: msg.commitHash,
      },
    },
  }));
}
