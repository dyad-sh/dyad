import type { SerializableChatTurnIntent } from "./transport";

export function serializeImmutableChatTurnPayload(
  intent: Omit<SerializableChatTurnIntent, "payloadHash">,
): string {
  return JSON.stringify({
    schemaVersion: intent.schemaVersion,
    intentId: intent.intentId,
    chatId: intent.chatId,
    appId: intent.appId,
    prompt: intent.prompt,
    redo: intent.redo,
    attachments: intent.attachments,
    selectedComponents: intent.selectedComponents,
    requestedChatMode: intent.requestedChatMode,
    userInputRequestId: intent.userInputRequestId,
    owner: intent.owner,
  });
}
