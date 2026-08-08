export type ChatAgentContextMessage = {
  role: "user" | "assistant";
  content: string;
};

const INTERNAL_CONTEXT_PATTERN =
  /<(?:retrieved_memory|local_vector_knowledge)>[\s\S]*?<\/(?:retrieved_memory|local_vector_knowledge)>/gi;

/**
 * Builds a retrieval query that preserves the subject of short follow-ups.
 *
 * Only user turns are included. Assistant answers may be wrong, so feeding
 * them back into retrieval can reinforce an earlier mistake.
 */
export function buildChatAgentRecallQuery(
  messages: ChatAgentContextMessage[],
): string {
  const query = messages
    .filter((message) => message.role === "user")
    .map((message) =>
      message.content.replace(INTERNAL_CONTEXT_PATTERN, "").trim(),
    )
    .filter(Boolean)
    .slice(-4)
    .join("\n\n");

  return query.length > 4_000 ? query.slice(-4_000) : query;
}

/**
 * Keeps the configured number of completed turns plus the current user turn.
 * The full transcript remains stored separately; this only bounds the model
 * prompt so a small local model does not lose the newest conversation to an
 * oversized request.
 */
export function limitChatAgentConversation(
  messages: ChatAgentContextMessage[],
  maxPreviousTurns: number,
): ChatAgentContextMessage[] {
  const safeTurnLimit =
    Number.isFinite(maxPreviousTurns) && maxPreviousTurns >= 0
      ? Math.floor(maxPreviousTurns)
      : 0;
  const maximumMessages = (safeTurnLimit + 1) * 2;
  let recentMessages = messages.slice(-maximumMessages);

  if (recentMessages[0]?.role === "assistant") {
    const firstUserIndex = recentMessages.findIndex(
      (message) => message.role === "user",
    );
    recentMessages =
      firstUserIndex === -1 ? [] : recentMessages.slice(firstUserIndex);
  }

  return recentMessages;
}

/**
 * Old vault memory is supplemental context. Put it before the live transcript
 * so the immediately preceding conversation stays closest to the new prompt
 * and is the last context discarded if a provider has to truncate input.
 */
export function prependChatAgentContext(
  messages: ChatAgentContextMessage[],
  context: string,
): ChatAgentContextMessage[] {
  if (!context.trim()) return messages;
  return [{ role: "user", content: context }, ...messages];
}
