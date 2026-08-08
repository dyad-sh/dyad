import type { ChatAgentMessage } from "@/components/chat-agent/types";

export function hasVisibleChatAgentPayload(message: ChatAgentMessage) {
  if (message.role === "user") return true;
  return Boolean(
    message.content.trim() ||
    message.attachments?.length ||
    message.toolResults?.length ||
    message.ragSources?.length ||
    message.artifact ||
    message.images?.length ||
    message.videoUrl ||
    message.readingDocument ||
    message.generatingImage ||
    message.generatingVideo,
  );
}

/** Removes failed, settled assistant placeholders while preserving media-only replies. */
export function pruneEmptyAssistantMessages(messages: ChatAgentMessage[]) {
  return messages.filter(hasVisibleChatAgentPayload);
}
