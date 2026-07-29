import type { ChatStreamInvocationRef } from "../invocation";

export function makeChatStreamRef(
  index: number,
  chatId: number,
): ChatStreamInvocationRef {
  return {
    kind: "chat-stream",
    entityKey: chatId,
    operationId: `chat-stream:${index}`,
  };
}
