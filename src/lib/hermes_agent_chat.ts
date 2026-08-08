import type { ChatAgentMessage } from "@/components/chat-agent/types";
import type { AgentOsChatMessage } from "@/ipc/types/agent_os";

export function getHermesConversationTitle(
  messages: ChatAgentMessage[],
  fallback: string,
): string {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) return fallback;

  const text = firstUser.content.trim();
  return text.length > 48 ? `${text.slice(0, 48)}…` : text || fallback;
}

export function buildHermesApiMessages(
  messages: ChatAgentMessage[],
): AgentOsChatMessage[] {
  return messages
    .filter((message) => message.content.trim())
    .map(({ role, content }) => ({ role, content }));
}
