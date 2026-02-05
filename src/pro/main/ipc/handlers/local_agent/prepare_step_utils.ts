/**
 * Utility for preparing step messages with injected user content.
 *
 * This module contains pure functions extracted from the prepareStep callback
 * in local_agent_handler.ts, enabling isolated unit testing.
 */

import { ImagePart, ModelMessage, TextPart, UserModelMessage } from "ai";
import type { UserMessageContentPart } from "./tools/types";
import { cleanMessageForOpenAI } from "@/ipc/utils/ai_messages_utils";

/**
 * A message that has been processed and is ready to inject.
 */
export interface InjectedMessage {
  insertAtIndex: number;
  /** Sequence number to preserve FIFO order for same-index messages */
  sequence: number;
  message: UserModelMessage;
}

/**
 * Transform a UserMessageContentPart to the format expected by the AI SDK.
 */
export function transformContentPart(
  part: UserMessageContentPart,
): TextPart | ImagePart {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  }
  // part.type === "image-url"
  return { type: "image", image: new URL(part.url) };
}

/**
 * Process pending user messages and add them to the injected messages list.
 * Each message is recorded with the current message count as its insertion index.
 *
 * @param pendingUserMessages - Queue of pending messages (will be mutated/emptied)
 * @param allInjectedMessages - List of already injected messages (will be mutated)
 * @param currentMessageCount - The current number of messages in the conversation
 */
export function processPendingMessages(
  pendingUserMessages: UserMessageContentPart[][],
  allInjectedMessages: InjectedMessage[],
  currentMessageCount: number,
): void {
  while (pendingUserMessages.length > 0) {
    const content = pendingUserMessages.shift()!;
    allInjectedMessages.push({
      insertAtIndex: currentMessageCount,
      sequence: allInjectedMessages.length, // Track insertion order
      message: {
        role: "user" as const,
        content: content.map(transformContentPart),
      },
    });
  }
}

/**
 * Build a new messages array with injected messages inserted at their recorded positions.
 * Messages are processed in reverse order of insertion index to avoid shifting issues.
 * For messages with the same index, we process in reverse sequence order to preserve FIFO.
 *
 * @param messages - The original messages array
 * @param injectedMessages - Messages to inject with their target indices
 * @returns New array with injected messages inserted at correct positions
 */
export function injectMessagesAtPositions<T>(
  messages: T[],
  injectedMessages: InjectedMessage[],
): (T | InjectedMessage["message"])[] {
  if (injectedMessages.length === 0) {
    return messages;
  }

  // Type as union from the start to allow inserting InjectedMessage["message"]
  const newMessages: (T | InjectedMessage["message"])[] = [...messages];

  // Sort by insertion index descending, then by sequence descending.
  // The sequence descending ensures that for same-index messages,
  // we splice the LAST-added first, so after all splices the FIRST-added
  // ends up in front (preserving FIFO order).
  const sortedInjections = [...injectedMessages].sort((a, b) => {
    if (a.insertAtIndex !== b.insertAtIndex) {
      return b.insertAtIndex - a.insertAtIndex;
    }
    return b.sequence - a.sequence;
  });

  for (const injection of sortedInjections) {
    newMessages.splice(injection.insertAtIndex, 0, injection.message);
  }

  return newMessages;
}

/**
 * The complete prepareStep logic as a pure function.
 *
 * @param options - The step options containing messages and other properties
 * @param pendingUserMessages - Queue of pending messages to process
 * @param allInjectedMessages - Accumulated list of injected messages
 * @returns Modified options with injected messages, or undefined if no changes needed
 */
export function prepareStepMessages<
  TMessage extends ModelMessage,
  T extends { messages: TMessage[]; [key: string]: unknown },
>(
  options: T,
  pendingUserMessages: UserMessageContentPart[][],
  allInjectedMessages: InjectedMessage[],
): (Omit<T, "messages"> & { messages: TMessage[] }) | undefined {
  const { messages, ...rest } = options;

  // Move any new pending messages to the permanent injected list
  processPendingMessages(
    pendingUserMessages,
    allInjectedMessages,
    messages.length,
  );

  // Clean messages for OpenAI compatibility during multi-step agent flows:
  // 1. Strip itemId to prevent "Item with id not found" errors
  // 2. Filter orphaned reasoning to prevent "reasoning without following item" errors
  const filteredMessages = messages.map(cleanMessageForOpenAI);

  // Check if we need to return modified options
  const hasInjections = allInjectedMessages.length > 0;
  const hasFilteredContent = filteredMessages.some(
    (msg, i) => msg !== messages[i],
  );

  if (!hasInjections && !hasFilteredContent) {
    return undefined;
  }

  // Build the new messages array with injections
  // Cast is safe because InjectedMessage["message"] is a valid ModelMessage
  const newMessages = hasInjections
    ? (injectMessagesAtPositions(
        filteredMessages,
        allInjectedMessages,
      ) as TMessage[])
    : filteredMessages;

  return { messages: newMessages, ...rest };
}
