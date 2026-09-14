import type { ModelMessage } from "ai";

/** Only for persisted history crossing subscription boundaries, never same-turn steps.
 * Old subscription history is also portable on reconnect: account-bound encrypted
 * state is not persisted as a trustworthy account identity.
 */
export function portableSubscriptionHistory(
  messages: ModelMessage[],
): ModelMessage[] {
  return messages.flatMap<ModelMessage>((message) => {
    if (!Array.isArray(message.content))
      return [{ ...message, providerOptions: undefined }];
    const content = message.content
      .filter((part) => part.type !== "reasoning")
      .map((part) => ({ ...part, providerOptions: undefined }));
    return content.length
      ? [{ ...message, providerOptions: undefined, content } as ModelMessage]
      : [];
  });
}
