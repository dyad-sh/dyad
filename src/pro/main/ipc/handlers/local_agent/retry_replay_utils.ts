/**
 * Utilities for building replay messages when retrying after a transient
 * stream termination. Extracted for testability.
 */

import type { ModelMessage } from "ai";

export type RetryReplayEvent =
  | {
      type: "assistant-text";
      text: string;
    }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    };

export function toToolResultOutput(value: unknown): {
  type: "text";
  value: string;
} {
  if (typeof value === "string") {
    return { type: "text", value };
  }
  try {
    return { type: "text", value: JSON.stringify(value) };
  } catch {
    return { type: "text", value: String(value) };
  }
}

export function maybeCaptureRetryReplayEvent(
  retryReplayEvents: RetryReplayEvent[],
  part: unknown,
): void {
  if (
    !part ||
    typeof part !== "object" ||
    !("type" in part) ||
    typeof (part as Record<string, unknown>).type !== "string"
  ) {
    return;
  }

  const record = part as Record<string, unknown>;

  if (
    record.type === "tool-call" &&
    typeof record.toolCallId === "string" &&
    typeof record.toolName === "string"
  ) {
    if (
      retryReplayEvents.some(
        (event) =>
          event.type === "tool-call" && event.toolCallId === record.toolCallId,
      )
    ) {
      return;
    }

    retryReplayEvents.push({
      type: "tool-call",
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      input:
        typeof record.input === "object" && record.input !== null
          ? record.input
          : {},
    });
    return;
  }

  if (
    record.type === "tool-result" &&
    typeof record.toolCallId === "string" &&
    typeof record.toolName === "string"
  ) {
    if (
      retryReplayEvents.some(
        (event) =>
          event.type === "tool-result" &&
          event.toolCallId === record.toolCallId,
      )
    ) {
      return;
    }

    retryReplayEvents.push({
      type: "tool-result",
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      output: record.output,
    });
  }
}

export function maybeCaptureRetryReplayText(
  retryReplayEvents: RetryReplayEvent[] | null,
  text: string,
): void {
  if (!retryReplayEvents || text.length === 0) {
    return;
  }

  const lastEvent = retryReplayEvents[retryReplayEvents.length - 1];
  if (lastEvent?.type === "assistant-text") {
    lastEvent.text += text;
    return;
  }

  retryReplayEvents.push({
    type: "assistant-text",
    text,
  });
}

/**
 * Builds replay messages from captured stream events for retry after a
 * transient stream termination. Only includes completed tool exchanges
 * (tool-call + tool-result pairs).
 */
export function buildRetryReplayMessages(
  retryReplayEvents: RetryReplayEvent[],
): ModelMessage[] {
  const replayMessages: ModelMessage[] = [];
  const pendingAssistantParts: Array<
    | { type: "text"; text: string }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
      }
  > = [];
  const toolCallsWithResult = new Set<string>();
  const toolResultsWithCall = new Set<string>();

  for (const event of retryReplayEvents) {
    if (event.type === "tool-call") {
      toolResultsWithCall.add(event.toolCallId);
      continue;
    }
    if (event.type === "tool-result") {
      toolCallsWithResult.add(event.toolCallId);
    }
  }

  const completedToolExchangeIds = new Set(
    [...toolCallsWithResult].filter((toolCallId) =>
      toolResultsWithCall.has(toolCallId),
    ),
  );

  const flushPendingAssistantMessage = () => {
    if (pendingAssistantParts.length === 0) {
      return;
    }
    replayMessages.push({
      role: "assistant",
      content: [...pendingAssistantParts],
    });
    pendingAssistantParts.length = 0;
  };

  for (const event of retryReplayEvents) {
    if (event.type === "assistant-text") {
      if (!event.text.trim()) {
        continue;
      }
      pendingAssistantParts.push({ type: "text", text: event.text });
      continue;
    }

    if (event.type === "tool-call") {
      if (!completedToolExchangeIds.has(event.toolCallId)) {
        continue;
      }
      pendingAssistantParts.push({
        type: "tool-call",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
      });
      continue;
    }

    if (!completedToolExchangeIds.has(event.toolCallId)) {
      continue;
    }
    flushPendingAssistantMessage();
    // Merge consecutive tool-result messages so parallel tool results stay
    // grouped with the preceding assistant message's tool-call blocks.
    // The Anthropic API requires every tool_use in an assistant message to
    // have its tool_result in the immediately following message.
    const lastReplayMsg = replayMessages[replayMessages.length - 1];
    if (
      lastReplayMsg?.role === "tool" &&
      Array.isArray(lastReplayMsg.content)
    ) {
      lastReplayMsg.content.push({
        type: "tool-result",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        output: toToolResultOutput(event.output),
      });
    } else {
      replayMessages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            output: toToolResultOutput(event.output),
          },
        ],
      });
    }
  }
  flushPendingAssistantMessage();

  return replayMessages;
}

export function maybeAppendRetryReplayForRetry(params: {
  retryReplayEvents: RetryReplayEvent[];
  currentMessageHistoryRef: ModelMessage[];
  accumulatedAiMessagesRef: ModelMessage[];
  onCurrentMessageHistoryUpdate: (next: ModelMessage[]) => void;
}) {
  const {
    retryReplayEvents,
    currentMessageHistoryRef,
    accumulatedAiMessagesRef,
    onCurrentMessageHistoryUpdate,
  } = params;

  const replayMessages = buildRetryReplayMessages(retryReplayEvents);

  if (replayMessages.length === 0) {
    return;
  }

  onCurrentMessageHistoryUpdate([
    ...currentMessageHistoryRef,
    ...replayMessages,
  ]);
  accumulatedAiMessagesRef.push(...replayMessages);
}
