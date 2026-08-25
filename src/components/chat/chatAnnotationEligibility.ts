import type { Message } from "@/ipc/types";

export function isChatMessageAnnotatable({
  role,
  isLastMessage,
  isCancelled,
  isStreaming,
}: {
  role: Message["role"];
  isLastMessage: boolean;
  isCancelled: boolean;
  isStreaming: boolean;
}): boolean {
  return role === "assistant" && isLastMessage && !isCancelled && !isStreaming;
}
