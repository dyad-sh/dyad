export type AutomaticChatScrollReason =
  | "chat-switch"
  | "initial-messages-loaded"
  | "stream-start";

export function automaticChatScrollReason(args: {
  previousChatId: number | undefined;
  chatId: number | undefined;
  previousOperationId: string;
  operationId: string;
  pendingInitialScrollChatId: number | undefined;
  messagesLength: number;
}): AutomaticChatScrollReason | null {
  if (args.previousChatId !== args.chatId) {
    return args.messagesLength > 0 ? "chat-switch" : null;
  }
  if (
    args.chatId !== undefined &&
    args.pendingInitialScrollChatId === args.chatId &&
    args.messagesLength > 0
  ) {
    return "initial-messages-loaded";
  }
  if (
    args.operationId !== "" &&
    args.operationId !== args.previousOperationId
  ) {
    return "stream-start";
  }
  return null;
}
