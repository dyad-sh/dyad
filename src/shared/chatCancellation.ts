const RESPONSE_CANCELLED_BY_USER_NOTICE = "[Response cancelled by user]";

export function isCancelledResponseContent(content: string): boolean {
  return content.trimEnd().endsWith(RESPONSE_CANCELLED_BY_USER_NOTICE);
}

export function appendCancelledResponseNotice(content: string): string {
  const trimmedContent = content.trimEnd();
  if (isCancelledResponseContent(trimmedContent)) {
    return trimmedContent;
  }

  return trimmedContent
    ? `${trimmedContent}\n\n${RESPONSE_CANCELLED_BY_USER_NOTICE}`
    : RESPONSE_CANCELLED_BY_USER_NOTICE;
}

export function stripCancelledResponseNotice(content: string): string {
  const trimmedContent = content.trimEnd();
  if (!isCancelledResponseContent(trimmedContent)) {
    return content;
  }

  return trimmedContent
    .slice(0, -RESPONSE_CANCELLED_BY_USER_NOTICE.length)
    .trimEnd();
}

/**
 * Filters out cancelled message pairs (user prompt + cancelled assistant response)
 * so the AI doesn't try to reconcile cancelled/incorrect prompts with new ones.
 */
export function filterCancelledMessagePairs<
  T extends { role: string; content: string },
>(messages: T[]): T[] {
  return messages.filter((msg, index) => {
    if (isCancelledResponseContent(msg.content)) {
      return false;
    }
    // Also filter the preceding user message that triggered the cancelled response
    if (
      msg.role === "user" &&
      index + 1 < messages.length &&
      isCancelledResponseContent(messages[index + 1].content)
    ) {
      return false;
    }
    return true;
  });
}

export function applyCancellationNoticeToLastAssistantMessage<
  T extends { role: string; content: string },
>(messages: T[]): T[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    const nextContent = appendCancelledResponseNotice(message.content);
    if (nextContent === message.content) {
      return messages;
    }

    const nextMessages = messages.slice();
    nextMessages[index] = {
      ...message,
      content: nextContent,
    };
    return nextMessages;
  }

  return messages;
}
